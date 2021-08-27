import Automerge from 'automerge'
import { DB } from './db'

export type Room = {
  name: string
  messages: Message[]
}

export type Message = {
  text: string
  time: number
}

const idb = new DB('dbname')

function create(name: string): Room {
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

export async function save(
  room: Room,
  changes: Automerge.BinaryChange[]
): Promise<string[]> {
  const tasks: Promise<string>[] = []
  changes.forEach((change) => {
    tasks.push(idb.storeChange(room.name, change))
  })
  return Promise.all(tasks)
}

export async function load(name: string): Promise<Room> {
  const doc = await idb.getDoc(name)
  if (!doc) return create(name)
  const state = doc.serializedDoc
    ? Automerge.load<Room>(doc.serializedDoc)
    : create(name)
  const [room] = Automerge.applyChanges(state, doc.changes)
  return room
}
