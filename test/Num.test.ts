import localred from '../src/index'

test('add', () => {
  let red = localred('test')
  red.on('message', (room, message) => {
    console.log('message', message)
  })

  red.load('my-room').then((room) => {
    console.log('loaded')
    red.lpush('my-room', 'blah')
  })
})

