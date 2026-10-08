import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { PLAN_LIMITS, productsInPlan, type PlanLimits } from '../lib/subscription'
import type { Role } from './team'
import type { BusinessSettings, DataStore, Product, ProductGroup, Supply } from './types'

interface StoreState {
  store: DataStore
  role: Role
  /** True when running on sample data in this browser only. */
  demo: boolean
  /** False when locked, or for staff beyond the plan: reports only. */
  canEdit: boolean
  /** True for staff the plan doesn't cover (so the screen can say why). */
  staffBlocked: boolean
  /** What the current plan allows (Unlimited in demo mode). */
  limits: PlanLimits
  /** Products the plan covers; others are read-only on Today. */
  inPlan: Set<string>
  /** Asks the server again whether entering numbers is allowed. */
  recheckAccess(): void
  groups: ProductGroup[]
  products: Product[]
  supplies: Supply[]
  settings: BusinessSettings
  saveSettings(settings: BusinessSettings): Promise<void>
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
  staffBlocked?: boolean
  limits?: PlanLimits
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
  staffBlocked = false,
  limits = PLAN_LIMITS.unlimited,
  onRecheckAccess,
  onResetDemo,
  children,
}: Props) {
  const [groups, setGroups] = useState<ProductGroup[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [settings, setSettings] = useState<BusinessSettings>({ entryLabels: 'made_thrown' })
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
      const [g, p, s, st] = await Promise.all([
        store.listGroups(),
        store.listProducts(),
        store.listSupplies(),
        store.getSettings(),
      ])
      setGroups(g)
      setProducts(p)
      setSupplies(s)
      setSettings(st)
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
        staffBlocked,
        limits,
        inPlan: productsInPlan(groups, products, limits.products),
        recheckAccess,
        groups,
        products,
        supplies,
        settings,
        saveSettings: async (next) => {
          await store.saveSettings(next)
          setSettings(next)
        },
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
