import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { LocalStore } from './localStore'
import type { DataStore, Product, ProductGroup } from './types'

interface StoreState {
  store: DataStore
  groups: ProductGroup[]
  products: Product[]
  loading: boolean
  /** Re-reads groups and products after a change. */
  refresh(): Promise<void>
  /** Demo only: put the sample data back. */
  resetDemo(): Promise<void>
}

const StoreContext = createContext<StoreState | null>(null)

const localStore = new LocalStore()

export function StoreProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<ProductGroup[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)

  const refresh = useCallback(async () => {
    const [g, p] = await Promise.all([localStore.listGroups(), localStore.listProducts()])
    setGroups(g)
    setProducts(p)
    setLoading(false)
  }, [])

  const resetDemo = useCallback(async () => {
    localStore.reset()
    await refresh()
    // Bump so screens holding entries reload them too.
    setVersion((v) => v + 1)
  }, [refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <StoreContext.Provider value={{ store: localStore, groups, products, loading, refresh, resetDemo }}>
      <div key={version} style={{ display: 'contents' }}>
        {children}
      </div>
    </StoreContext.Provider>
  )
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
