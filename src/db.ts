import Dexie from 'dexie'
import Automerge from 'automerge'
import debug from 'debug'

const MAX_CHANGES_TO_KEEP = 100

interface SavedChange {
  docId: string
  change: Automerge.BinaryChange
  timestamp: number
}

interface SavedBinary {
  docId: string
  serializedDoc: Automerge.BinaryDocument
}

interface SavedState {
  docId: string
  actorId: string
  state: Automerge.BinarySyncState
}

interface SavedBlob {
  id: string
  data: Uint8Array
}

export interface Doc {
  changes: Automerge.BinaryChange[]
  serializedDoc: Automerge.BinaryDocument | undefined
}

export class DB extends Dexie {
  documents: Dexie.Table<SavedBinary, string>
  changes: Dexie.Table<SavedChange, string>
  states: Dexie.Table<SavedState>
  blobs: Dexie.Table<SavedBlob, string>
  private log

  constructor(dbname: string) {
    super(dbname)
    this.version(3).stores({
      documents: 'id++,docId',
      changes: 'id++,docId',
      states: 'id++, [docId+actorId]', // compound index
      blobs: 'id',
    })
    this.documents = this.table('documents')
    this.changes = this.table('changes')
    this.states = this.table('states')
    this.blobs = this.table('blobs')
    this.log = debug('bc:automerge:db')
  }

  async storeSyncState(
    docId: string,
    actorId: string,
    state: Automerge.SyncState
  ): Promise<number> {
    const item = await this.states
      .where(['docId', 'actorId'])
      .equals([docId, actorId])
      .first()
    const encodedState = Automerge.Backend.encodeSyncState(state)
    if (item) return this.states.update(item, { state: encodedState })
    else return this.states.add({ docId, actorId, state: encodedState })
  }

  async getSyncState(
    docId: string,
    actorId: string
  ): Promise<Automerge.SyncState> {
    const item = await this.states.where({ docId, actorId }).first()
    if (item) return Automerge.Backend.decodeSyncState(item.state)
    else return Automerge.initSyncState()
  }

  async storeChange(
    docId: string,
    change: Automerge.BinaryChange
  ): Promise<string> {
    console.log('saving')
    return this.changes.add({ docId, change, timestamp: Date.now() })
  }

  async getDoc(docId: string): Promise<Doc> {
    const doc = await this.documents.get(docId)
    const changes = await this.changes.where({ docId }).toArray()
    return {
      serializedDoc: doc?.serializedDoc,
      changes: changes.map((c) => c.change),
    }
  }

  // TODO: not fully tested.
  async saveSnapshot(docId: string): Promise<[string, void]> {
    const { serializedDoc, changes } = await this.getDoc(docId)

    let doc = serializedDoc ? Automerge.load(serializedDoc) : Automerge.init()
    doc = Automerge.applyChanges(doc, changes)

    const lastChangeTime = changes.reduce((max, rec) => {
      const change = Automerge.decodeChange(rec)
      return Math.max(change.time, max)
    }, 0)

    const nextSerializedDoc = Automerge.save(doc)

    const oldChanges = this.changes.where({ docId })
    const deletable = oldChanges.filter((c) => c.timestamp > lastChangeTime)
    const deleted = this.changes.bulkDelete(await deletable.primaryKeys())
    const add = this.documents.put({
      serializedDoc: nextSerializedDoc,
      docId,
    })
    return Promise.all([add, deleted])
  }

  async destroy(): Promise<void> {
    await this.documents.clear()
    await this.changes.clear()
    await this.states.clear()
  }
}
