import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Role } from './team'
import type { DataStore, Product, ProductGroup } from './types'

interface StoreState {
  store: DataStore
  role: Role
  /** True when running on sample data in this browser only. */
  demo: boolean
  /** False when the trial or paid period is over: reports only, no new numbers. */
  canEdit: boolean
  /** Asks the server again whether entering numbers is allowed. */
  recheckAccess(): void
  groups: ProductGroup[]
  products: Product[]
  loading: boolean
  error: boolean
  /** Re-reads groups and products after a change. */
  refresh(): Promise<void>
  /** Demo only: put the sample data back. */
  resetDemo?: () => Promise<void>
}

const StoreContext = createContext<StoreState | null>(null)

interface Props {
  store: DataStore
  role: Role
  demo?: boolean
  canEdit?: boolean
  onRecheckAccess?: () => void
  /** Demo only: wipes local data and reseeds the sample business. */
  onResetDemo?: () => void
  children: ReactNode
}

export function StoreProvider({
  store,
  role,
  demo = false,
  canEdit = true,
  onRecheckAccess,
  onResetDemo,
  children,
}: Props) {
  const [groups, setGroups] = useState<ProductGroup[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [version, setVersion] = useState(0)

  // Stable identity: screens list it in effect dependencies.
  const recheckRef = useRef(onRecheckAccess)
  useEffect(() => {
    recheckRef.current = onRecheckAccess
  }, [onRecheckAccess])
  const recheckAccess = useCallback(() => recheckRef.current?.(), [])

  const refresh = useCallback(async () => {
    try {
      const [g, p] = await Promise.all([store.listGroups(), store.listProducts()])
      setGroups(g)
      setProducts(p)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [store])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  const resetDemo = onResetDemo
    ? async () => {
        onResetDemo()
        await refresh()
        // Bump so screens holding entries reload them too.
        setVersion((v) => v + 1)
      }
    : undefined

  return (
    <StoreContext.Provider
      value={{
        store,
        role,
        demo,
        canEdit,
        recheckAccess,
        groups,
        products,
        loading,
        error,
        refresh,
        resetDemo,
      }}
    >
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
