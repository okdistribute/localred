import events from 'events'
import { createHash } from 'crypto'
import Automerge, { BinaryChange, BinarySyncMessage } from 'automerge'

export default class Client<T> extends events.EventEmitter {
  open = false
  syncState: Automerge.SyncState
  client: WebSocket
  documentId: string
  port: number
  document: Automerge.Doc<T>

  constructor(documentId: string, document: Automerge.Doc<T>, port = 8080, publish = false) {
    super()
    this.document = document
    this.port = port

    if (publish) {
      this.documentId = documentId
    } else {
      // documentId is hidden from server
      const hash = createHash('sha256')
      hash.update(documentId)
      this.documentId = hash.digest('hex')
    }

    // TODO: need multiple sync states, one per peer.
    this.syncState = Automerge.initSyncState()
    this.client = this._createClient()
  }

  _createClient(): WebSocket {
    this.syncState = Automerge.initSyncState()
    this.client = new WebSocket(
      `ws://localhost:${this.port}/${this.documentId}`,
      'echo-protocol'
    )
    this.client.binaryType = 'arraybuffer'
    console.log('Joining', this.documentId)

    this.client.onerror = () => {
      console.log('Connection Error')
    }

    this.client.onopen = () => {
      console.log('WebSocket Client Connected')
      if (this.client.readyState === this.client.OPEN) {
        this.open = true
        this.emit('open')
        this.updatePeers()
      }
    }

    this.client.onclose = () => {
      setTimeout(() => {
        this._createClient()
      }, 100)
    }

    this.client.onmessage = (e) => {
      const msg = new Uint8Array(e.data)
      const [newDoc, newSyncState, patch] = Automerge.receiveSyncMessage(
        this.document,
        this.syncState,
        msg as BinarySyncMessage
      )
      let changes: BinaryChange[] = []
      if (patch) {
        // TODO: this is not great! I need the changes to know
        // what the remote peer changed in the document
        // This is useful in this demo for persistence.
        changes = Automerge.Backend.getChanges(
          Automerge.Frontend.getBackendState(newDoc),
          Automerge.Backend.getHeads(this.document) || []
        )
      }
      this.document = newDoc
      this.syncState = newSyncState
      // I shouldn't have to listen to the websocket to know when to update..
      this.emit('update', changes)
      this.updatePeers()
    }
    return this.client
  }

  localChange(newDoc: Automerge.Doc<T>): void {
    this.document = newDoc
    const change = Automerge.getLastLocalChange(newDoc)
    this.emit('update', [change])
    if (!this.open) {
      this.once('open', () => this.updatePeers())
      return
    }
    this.updatePeers()
  }

  updatePeers(): void {
    const [nextSyncState, msg] = Automerge.generateSyncMessage(
      this.document,
      this.syncState
    )
    this.syncState = nextSyncState
    if (msg) {
      console.log('sending sync msg')
      this.client.send(msg)
    } else {
      console.log('no sync message to send')
    }
  }

  close(): void {
    console.log('Websocket client closed.')
    this.client.close()
  }
}
