const createSwarm = require('../killa-beez')
const funky = require('funky')
const getUserMedia = require('getusermedia')
const qs = require('querystring')
const mediaRecorder = require('../media-recorder-stream')
const bel = require('bel')
const WebTorrent = require('webtorrent')
const streamToBlobURL = require('stream-to-blob-url')
const blobToBuffer = require('blob-to-buffer')
const FileWriteStream = require('filestream/write')

const byId = id => document.getElementById(id)
const values = obj => Object.keys(obj).map(k => obj[k])
const torrentClient = new WebTorrent()

function getBlobURL (file, cb) {
  if (file.createReadStream) {
    streamToBlobURL(file.createReadStream(), 'audio/wav', cb)
  } else {
    cb(null, URL.createObjectURL(file))
  }
}

let signalHost = 'https://signalexchange.now.sh'
let roomHost = 'https://roomexchange.now.sh'

let myMicrophone
let mySwarm
let myRecorder

const recordButton = bel`
<button id="record" class="ui compact labeled icon button">
  <i class="unmute icon"></i>
    Record
</button>
`

function recording (swarm, microphone) {
  let remotes = []

  function startRecording () {
    let streams = []
    let files = {}
    let me = mediaRecorder(microphone, {mimeType: 'audio/webm;codecs=opus'})
    let writer = FileWriteStream()
    writer.on('file', file => {
      console.log('own file created', file)
    })
    me.pipe(writer)
    files[swarm.publicKey] = writer
    writer.publicKey = swarm.publicKey
    me.publicKey = swarm.publicKey
    streams.push(me)

    swarm.on('substream', (stream, id) => {
      // TODO: check id
      if (id.slice(0, 'recording:'.length) !== 'recording:') return
      streams.push(stream)
      let pubkey = id.slice('recording:'.length)
      let writer = FileWriteStream()
      writer.on('file', file => {
        console.log('substream file created', file)
      })
      stream.on('end', () => {
        console.log('substream ended')
      })
      console.log('writer', writer)
      writer.publicKey = swarm.publicKey
      stream.pipe(writer)
      files[pubkey] = writer
      // TODO: update UI as the file streams
    })

    remotes.forEach(commands => commands.record())

    recordButton.onclick = () => {
      me.stop()
      remotes.forEach(commands => commands.stopRecording())
      $(recordButton).remove()
    }
    $('button#record i')
    .removeClass('unmute')
    .addClass('stop')
  }

  function mkrpc (peer) {
    // Create RPC services scoped to this peer.
    let rpc = {}
    let stream
    rpc.record = () => {
      // TODO: grey record button
      stream = mediaRecorder(microphone, {mimeType: 'audio/webm;codecs=opus'})
      stream.pipe(peer.meth.stream(`recording:${swarm.publicKey}`))
      // TODO: keep track of bits sent and update a UI
    }
    rpc.stopRecording = () => {
      stream.stop()
      // TODO: re-enable record button
    }
    peer.meth.commands(rpc, 'recording')
  }

  swarm.on('peer', mkrpc)
  values(swarm.peers).forEach(mkrpc)
  swarm.on('commands:recording', commands => {
    remotes.push(commands)
  })

  return startRecording
}

function joinRoom (room) {
  room = `peer-call:${room}`
  let mediaopts = { audio: true, video: false }
  getUserMedia(mediaopts, (err, audioStream) => {
    if (err) return console.error(err)
    if (!audioStream) return console.error("no audio")
    myMicrophone = audioStream
    window.myMicrophone = myMicrophone
    let p = addPerson(audioStream)
    let swarm = createSwarm(signalHost, {stream: audioStream})
    swarm.joinRoom(roomHost, room)
    swarm.on('stream', stream => {
      stream.peer.audioStream = stream
      stream.publicKey = stream.peer.publicKey
      let elem = addPerson(stream, true)
      elem.audioStream = stream
      let remotes = values(swarm.peers).length
      elem.querySelector('div.person-name').textContent = `Caller (${remotes})`
      document.getElementById('audio-container').appendChild(elem)
    })
    swarm.on('disconnect', pubKey => {
      $(document.getElementById(`a${pubKey}`)).remove()
    })
    mySwarm = swarm
    document.getElementById('audio-container').appendChild(p)
    document.body.appendChild(recordButton)

    recordButton.onclick = recording(swarm, audioStream)
  })
}
const mainButtons = funky`
<div class="join-container">
  <div class="ui large buttons">
    <button id="join-party" class="ui button">Join the Party 🎉</button>
    <div class="or"></div>
    <button id="create-room" class="ui button">🚪 Create New Room</button>
  </div>
</div>`

const remoteAudio = funky`
<div class="card" id="a${id => id}">
  <div style="height:49px;width:290">
    <canvas id="canvas"
      width="290"
      height="49"
      class="person"
      >
    </canvas>
  </div>
  <div class="extra content">
    <div contenteditable="true" class="header person-name">Me</div>
    <div class="volume">
      <div class="ui toggle checkbox">
        <input type="checkbox" name="mute">
        <label>Mute</label>
      </div>
      <input type="range" min="0" max="2" step=".05" />
    </div>
  </div>
</div>
`

const downloadView = funky`
<div class="card download-card" id="b${id => id}">
  <div class="content">
    <div class="ui active progress" data-percent="0">
      <div class="bar">
        <div class="progress"></div>
      </div>
      <div class="label">Downloading Their Recording</div>
    </div>
  </div>
</div>
`
const uploadView = funky`
<div class="card upload-card" id="c${id => id}">
  <div class="content">
    <div class="ui active progress" data-percent="0">
      <div class="bar">
        <div class="progress"></div>
      </div>
      <div class="label">Sending My Audio</div>
    </div>
  </div>
</div>
`

const trackView = funky`
<div class="ui segment track-container">
  <div class="ui top attached label">${info => info.name}</div>
  <div class="ui special cards">
    ${info => info.download || ''}
    ${info => info.upload || ''}
    ${info => info.localTrack}
    ${info => info.call}
  </div>
</div>
`

const localTrackView = funky`
  <div class="card" id="d${id => id}">
    <div class="local-track-title">
      <input type="radio" checked="checked" />
      <span class="local-track-title"></span>
    </div>
    <a download="track.wav" class="download-link">
      <i data-content="Download" class="save link icon"></i>
    </a>
    <div style="height:49px;width:290">
      <canvas id="canvas"
        width="290"
        height="49"
        class="person"
        >
      </canvas>
    </div>
    <div class="extra content">
      <div class="volume">
        <label>Gain</label>
        <input type="range" min="0" max="2" step=".05" />
      </div>
    </div>
  </div>
`

const WIDTH = 290
const HEIGHT = 49
let looping

function startLoop () {
  if (looping) return

  let lastTime = Date.now()

  function draw () {
    requestAnimationFrame(draw)
    var now = Date.now()
    if (now - lastTime < 50) return

    var elements = [...document.querySelectorAll('canvas.person')]
    elements.forEach(drawPerson)

    function drawPerson (canvas) {
      var canvasCtx = canvas.canvasCtx
      var analyser = canvas.analyser
      var bufferLength = analyser._bufferLength

      var dataArray = new Uint8Array(bufferLength)

      analyser.getByteFrequencyData(dataArray)

      canvasCtx.clearRect(0, 0, WIDTH, HEIGHT)
      var barWidth = (WIDTH / bufferLength) * 5
      var barHeight
      var x = 0
      var total = 0
      for (var i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 3
        if (barHeight > 10) {
          canvasCtx.fillStyle = 'rgb(66,133,244)'
          canvasCtx.fillRect(x, HEIGHT - barHeight / 2, barWidth, barHeight)
        }
        x += barWidth + 1
        total += barHeight
      }
      lastTime = now

      if (total > 1000) {
        $(canvas.parentNode.parentNode).addClass('pulse')
      } else {
        $(canvas.parentNode.parentNode).removeClass('pulse')
      }
    }
  }
  draw()
  looping = true
}

let context = new AudioContext()
const waudio = require('waudio')(context)

function connectAudio (stream, play, view) {
  let element = view(stream.publicKey)
  let volume = waudio.gain()
  let analyser = context.createAnalyser()
  stream = waudio(stream)

  let volumeSelector = 'input[type=range]'
  let muteSelector = 'input[type=checkbox]'
  let muteElement = element.querySelector(muteSelector)

  $(muteElement).checkbox('toggle').click((c) => {
    let label = c.target.parentNode.querySelector('label')
    let state = label.textContent
    if (state === 'Mute') {
      c.target.parentNode.querySelector('label').textContent = 'Muted'
      element.querySelector(volumeSelector).disabled = true
      stream.mute()
    } else {
      c.target.parentNode.querySelector('label').textContent = 'Mute'
      element.querySelector(volumeSelector).disabled = false
      stream.unmute()
    }
  })

  $(element.querySelector(volumeSelector)).change(function () {
    volume.set(this.value)
  })
  stream.send(volume).send(analyser)

  var canvas = element.querySelector('canvas.person')
  canvas.canvasCtx = canvas.getContext("2d")
  analyser.fftSize = 256
  analyser._bufferLength = analyser.frequencyBinCount
  canvas.canvasCtx.clearRect(0, 0, WIDTH, HEIGHT)
  canvas.analyser = analyser
  startLoop()

  if (play) {
    volume.output()
  }

  element.stream = stream
  element.volume = volume

  return element
}

function addPerson (stream, play) {
  return connectAudio(stream, play, remoteAudio)
}

function ask () {
  let buttons = mainButtons()
  document.getElementById('main-container').appendChild(buttons)
  document.getElementById('join-party').onclick = () => {
    window.location = '?room=party'
  }
  document.getElementById('create-room').onclick = () => {
    window.location = `?room=${encodeURIComponent(getRandom())}`
  }
}

if (!window.location.search) {
  ask()
} else {
  let opts = qs.parse(window.location.search.slice(1))
  if (!opts.room) return ask()
  joinRoom(opts.room)
}

function getRandom () {
  function toBase64 (buf) {
    buf = new Uint8Array(buf)
    var s = ''
    for (var i = 0; i < buf.byteLength; i++) {
      s += String.fromCharCode(buf[i])
    }
    return btoa(s)
  }
  let key = new Uint8Array(8)
  window.crypto.getRandomValues(key)
  let s = toBase64(key)
  return s.slice(0, s.length - 1)
}

