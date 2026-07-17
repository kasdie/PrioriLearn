const context = document.getElementById('context')
const focusButton = document.getElementById('open-focus')

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url?.includes('canvas')) {
    context.textContent = 'Open a Canvas course page to capture context'
    return
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ title: document.title, heading: document.querySelector('h1')?.textContent?.trim() }),
    })
    context.textContent = `Canvas · ${result?.heading || result?.title || 'Course page'}`
  } catch {
    context.textContent = 'Canvas context is available after the page finishes loading'
  }
}

focusButton.addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://127.0.0.1:4173/?focus=programming-assignment-3' })
})

readActiveTab()
