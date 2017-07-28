const {ipcRenderer} = require('electron')
const {runInThisContext} = require('vm')

const constants = require('../common/constants');

// Check whether pattern matches.
// https://developer.chrome.com/extensions/match_patterns
const matchesPattern = function (pattern) {
  if (pattern === '<all_urls>') return true
  const regexp = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
  const url = `${location.protocol}//${location.host}${location.pathname}`
  return url.match(regexp)
}

// Run the code with chrome API integrated.
const runContentScript = function (extensionId, url, code) {
  const context = {}
  require('./chrome-api').injectTo(extensionId, false, context)
  const wrapper = `(function (chrome) {\n  ${code}\n  })`
  const compiledWrapper = runInThisContext(wrapper, {
    filename: url,
    lineOffset: 1,
    displayErrors: true
  })
  return compiledWrapper.call(this, context.chrome)
}

// Run injected scripts.
// https://developer.chrome.com/extensions/content_scripts
const injectContentScript = function (extensionId, script) {
  if (!script.matches.some(matchesPattern)) return

  if (script.js) {
    for (const {url, code} of script.js) {
      const fire = runContentScript.bind(window, extensionId, url, code)
      if (script.runAt === 'document_start') {
        process.once('document-start', fire)
      } else if (script.runAt === 'document_end') {
        process.once('document-end', fire)
      } else if (script.runAt === 'document_idle') {
        document.addEventListener('DOMContentLoaded', fire)
      }
    }
  }

  if (script.css) {
    for (const {code} of script.css) {
      process.once('document-end', () => {
        var node = document.createElement('style')
        node.innerHTML = code
        window.document.body.appendChild(node)
      })
    }
  }
}

// Handle the request of chrome.tabs.executeJavaScript.
ipcRenderer.on(constants.TABS_EXECUTESCRIPT, function (event, senderWebContentsId, requestId, extensionId, url, code) {
  const result = runContentScript.call(window, extensionId, url, code)
  ipcRenderer.sendToAll(senderWebContentsId, `${constants.TABS_EXECUTESCRIPT_RESULT_}${requestId}`, result)
})

// Read the renderer process preferences.
const getContentScripts = () => ipcRenderer.sendSync('GET_CONTENTSCRIPTS_SYNC');
const contentScripts = getContentScripts();
Object.keys(contentScripts).forEach(key => {
  const cs = contentScripts[key];
  if (cs.contentScripts) {
    for (const script of cs.contentScripts) {
      injectContentScript(cs.extensionId, script)
    }
  }
})