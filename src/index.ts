import Automerge from 'automerge'
import { DB } from './db'
import Client from './WebSocketClient'
import events from 'events'

export type Room = {
  name: string
  messages: string[]
}

let instance: LocalRed

export default function start(dbname: string): LocalRed {
  if (!instance) instance = new LocalRed(dbname || 'dbname')
  return instance
}

export class LocalRed extends events.EventEmitter {
  rooms = new Map<string, Client<Room>>()
  idb: DB
  changeQueue = new Map <string, Automerge.BinaryChange[]> ()

  constructor(dbname: string) {
    super()
    this.idb = new DB(dbname)
  }

  _get(roomName: string): Client<Room> {
    const client = this.rooms.get(roomName)
    if (client) return client
    const room = this._create(roomName)
    return this._createClient(roomName, room)
  }

  _createClient(roomName: string, room: Room): Client<Room> {
    let newClient = new Client(roomName, room)
    newClient.on('open', () => {
      this.emit('open')
    })
    newClient.on('error', () => {
      this.emit('error')
    })
    this.rooms.set(roomName, newClient)
    return newClient
  }

  _localChange(roomName: string, fn: Automerge.ChangeFn<Room>): Client<Room> {
    const client = this._get(roomName)
    const newDoc = Automerge.change(client.document, fn)
    client.localChange(newDoc)
    return client
  }

  lrange(roomName: string, min: number, max: number): string[] {
    const client = this._get(roomName)
    return client.document.messages.slice(min, max)
  }

  lpush(roomName: string, text: string): Room {
    const client = this._localChange(roomName, (doc) => {
      doc.messages.unshift(text)
    })
    return client.document
  }

  close(roomName: string): void {
    const client = this._get(roomName)
    client.close()
    this.rooms.delete(roomName)
  }

  _create(name: string): Room {
    const head = Automerge.change(
      Automerge.init<Room>('0000'),
      { time: 0 },
      (doc: Room) => {
        doc.name = name
        doc.messages = []
      }
    )
    const change = Automerge.Frontend.getLastLocalChange(head)
    const empty = Automerge.init<Room>()
    const [room] = Automerge.applyChanges(empty, [change])
    return room
  }

  async save(name: string, changes: Automerge.BinaryChange[]): Promise<string[]> {
    const tasks: Promise<string>[] = []
    changes.forEach((change) => {
      tasks.push(this.idb.storeChange(name, change))
    })
    return Promise.all(tasks)
  }

  async load(name: string): Promise<Room> {
    const doc = await this.idb.getDoc(name)
    if (!doc) return this._create(name)
    let observable = new Automerge.Observable()
    const state = doc.serializedDoc
      ? Automerge.load<Room>(doc.serializedDoc, {observable})
      : this._create(name)
    const [room] = Automerge.applyChanges(state, doc.changes);
    observable.observe(room, (diff: Automerge.MapDiff | Automerge.ListDiff | Automerge.ValueDiff, before: Room, after: Room, local: boolean, changes: Automerge.BinaryChange[]) => {
      console.log('patch!')
      //@ts-ignore
      if (diff.props && diff.props.messages) {
        //@ts-ignore
        let opId = Object.values(diff.props.messages)[0]
        //@ts-ignore
        opId.edits.forEach(edit => {
          this.emit('message', name, edit.value)
        })
      }
      if (changes.length) {
        console.log('saving changes', changes.length)
        this.save(name, changes).then(() => {
          console.log('Saved')
        })
      }
    })
    this._createClient(name, room)
    return room
  }

}