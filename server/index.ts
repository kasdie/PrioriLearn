import { createApplication } from './app.js'

const { app, config, aiProvider } = await createApplication()

app.listen(config.port, '127.0.0.1', () => {
  console.log(`PrioriLearn API listening on http://127.0.0.1:${config.port} (${aiProvider.name})`)
})
