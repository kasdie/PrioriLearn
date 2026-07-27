import { createApplication } from './app.js'

const { app, config, aiProvider, errorReporter, processExtractionQueue } = await createApplication()

const host = process.env.HOST ?? '0.0.0.0'
app.listen(config.port, host, () => {
  console.log(`PrioriLearn API listening on http://${host}:${config.port} (${aiProvider.name})`)
})

let extractionWorkerRunning = false
const runExtractionWorker = async () => {
  if (extractionWorkerRunning) return
  extractionWorkerRunning = true
  try {
    const result = await processExtractionQueue()
    if (config.structuredLogging && result.claimed > 0) {
      console.info(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        event: 'extraction_worker',
        ...result,
      }))
    }
  } catch (error) {
    errorReporter.captureException(error, { source: 'extraction_worker' })
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'extraction_worker_error',
      message: error instanceof Error ? error.message : 'Unknown extraction worker error',
    }))
  } finally {
    extractionWorkerRunning = false
  }
}

const extractionTimer = setInterval(
  () => void runExtractionWorker(),
  config.extractionWorkerIntervalMs,
)
extractionTimer.unref()
void runExtractionWorker()
