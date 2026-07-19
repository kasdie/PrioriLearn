import { createApplication } from './app.js'

const { app, config, aiProvider } = await createApplication()

const host = process.env.HOST ?? '0.0.0.0'
app.listen(config.port, host, () => {
  console.log(`PrioriLearn API listening on http://${host}:${config.port} (${aiProvider.name})`)
})
