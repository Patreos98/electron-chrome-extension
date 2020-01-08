const { ipcRenderer } = require('electron');
const url = require('url');

const Event = require('./event');
const constants = require('../../common/constants');
const { log } = require('../../common/utils');
const Port = require('./runtime/port')

let originResultID = 1

class Runtime {

  constructor(context, extensionId, isBackgroundPage) {
    this.context = context;
    this.id = extensionId;
    this.isBackgroundPage = isBackgroundPage;

    this.onConnect = new Event()
    this.onMessage = new Event()
    this.onInstalled = new Event()
    this.onStartup = new Event()
    this.onUpdateAvailable = new Event()
    this.onSuspend = new Event()

    this.getURL = this.getURL.bind(this)
    this.getPlatformInfo = this.getPlatformInfo.bind(this)
    this.connect = this.connect.bind(this)
    this.sendMessage = this.sendMessage.bind(this)
    this.getManifest = this.getManifest.bind(this)
    this.setUninstallURL = this.setUninstallURL.bind(this)
  }

  getURL(path) {
    let canonicalPath = undefined;

    if (path) {
      if (path.startsWith('/')) {
        canonicalPath = path;
      } else {
        canonicalPath = `/${path}`;
      }
    } else {
      canonicalPath = '/';
    }

    return url.format({
      protocol: constants.EXTENSION_PROTOCOL,
      slashes: true,
      hostname: this.id,
      pathname: canonicalPath
    })
  }

  getPlatformInfo() {
    const archMapNodeChrome = {
      'arm': 'arm',
      'ia32': 'x86-32',
      'x64': 'x86-64'
    }
    const osMapNodeChrome = {
      'darwin': 'mac',
      'freebsd': 'openbsd',
      'linux': 'linux',
      'sunos': 'linux',
      'win32': 'win'
    }

    const arch = archMapNodeChrome[process.arch];
    const platform = osMapNodeChrome[process.platform];
    return {
      PlatformOs: platform,
      PlatformArch: arch,
      PlatformNaclArch: arch
    }
  }

  connect(...args) {
    if (this.isBackgroundPage) {
      console.error('chrome.runtime.connect is not supported in background page')
      return
    }

    // Parse the optional args.
    let targetExtensionId = this.id
    let connectInfo = { name: '' }
    if (args.length === 1) {
      if (typeof args[0] === 'string') {
        targetExtensionId = args[0]
      } else {
        connectInfo = args[0]
      }
    } else if (args.length === 2) {
      [targetExtensionId, connectInfo] = args
    }

    const url = window && window.location ? window.location.href : undefined;
    const { tabId, portId } = ipcRenderer.sendSync(constants.RUNTIME_CONNECT, targetExtensionId, connectInfo, url)
    return Port.get(this.context, tabId, portId, this.id, connectInfo.name)
  }

  sendMessage(...args) {
    if (this.isBackgroundPage) {
      console.error('chrome.runtime.sendMessage is not supported in background page')
      return
    }

    // Parse the optional args.
    let targetExtensionId = this.id
    let message
    if (args.length === 1) {
      message = args[0]
    } else if (args.length === 2) {
      // A case of not provide extension-id: (message, responseCallback)
      if (typeof args[1] === 'function') {
        ipcRenderer.once(`${constants.RUNTIME_SENDMESSAGE_RESULT_}${originResultID}`, (event, result) => {
          log(`Runtime message result (runtime.js) #${originResultID}:`, args[0], result)
          return args[1](result);
        })
        message = args[0]
      } else {
        [targetExtensionId, message] = args
      }
    } else {
      console.error('options is not supported')
      ipcRenderer.once(`${constants.RUNTIME_SENDMESSAGE_RESULT_}${originResultID}`, (event, result) => args[2](result))
    }

    ipcRenderer.send(constants.RUNTIME_SEND_MESSAGE, targetExtensionId, message, originResultID)
    originResultID++
  }

  getManifest() {
    return ipcRenderer.sendSync(constants.RUNTIME_GET_MANIFEST, this.id)
  }

  setUninstallURL(url, callback) {
    if (callback)
      return callback
  }

  incrementOriginResultID() {
    originResultID++
  }
}

const store = new Map();

const getRuntime = (extensionId, isBackgroundPage) => {
  const key = `${extensionId}-${isBackgroundPage}`;

  if (store.has(key)) {
    return store.get(key)
  } else {
    const newRuntime = new Runtime(extensionId, isBackgroundPage)
    store.set(key, newRuntime)
    return newRuntime
  }
}

exports.setup = (extensionId, isBackgroundPage) => getRuntime(extensionId, isBackgroundPage)
