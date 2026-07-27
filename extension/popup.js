const context = document.getElementById('context')
const contextDetail = document.getElementById('context-detail')
const openButton = document.getElementById('open-priorilearn')
const appOrigin = 'https://priori-learn-kasdies-projects.vercel.app'
let canvasContext = ''

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) {
    context.textContent = 'No active page'
    contextDetail.textContent = 'Open PrioriLearn without importing page context.'
    return
  }

  const hostname = new URL(tab.url).hostname.toLowerCase()
  const isCanvas = hostname.includes('canvas') || hostname.endsWith('.instructure.com')
  if (!isCanvas) {
    context.textContent = 'No Canvas context'
    contextDetail.textContent = 'Open a Canvas course page, then reopen this extension.'
    return
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title,
        heading: document.querySelector('h1')?.textContent?.trim(),
      }),
    })
    canvasContext = (result?.heading || result?.title || 'Canvas course page').slice(0, 200)
    context.textContent = 'Canvas context ready'
    contextDetail.textContent = canvasContext
  } catch {
    context.textContent = 'Canvas page is still loading'
    contextDetail.textContent = 'Nothing has been sent to PrioriLearn.'
  }
}

openButton.addEventListener('click', () => {
  const destination = new URL(appOrigin)
  if (canvasContext) {
    destination.searchParams.set('source', 'canvas')
    destination.searchParams.set('context', canvasContext)
  }
  chrome.tabs.create({ url: destination.toString() })
})

readActiveTab()
