import { useState, useEffect, useCallback } from 'react'
import { api, type Provider } from '../lib/api'

export function useModels() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [currentProvider, setCurrentProviderState] = useState('claude')
  const [currentModel, setCurrentModelState] = useState('claude-sonnet-4-6')
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const data = await api.getModels()
      setProviders(data.providers)
      setCurrentProviderState(data.current.provider)
      setCurrentModelState(data.current.model)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const setModel = async (provider: string, model: string) => {
    setCurrentProviderState(provider)
    setCurrentModelState(model)
    await api.patchConfig({ llm: { provider, model, temperature: 0.7, maxTokens: 4096 } })
  }

  return { providers, currentProvider, currentModel, setModel, loading, reload }
}
