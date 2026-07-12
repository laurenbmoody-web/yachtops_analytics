import React, { createContext, useContext, useState, useEffect } from 'react';

// App-wide marketplace basket ("The Counter"). Lifted out of the
// marketplace page so the nav bar can show a live count from anywhere and
// the basket survives navigation / reload. Persisted to localStorage.
const BasketContext = createContext();

export const useBasket = () => {
  const ctx = useContext(BasketContext);
  if (!ctx) throw new Error('useBasket must be used within BasketProvider');
  return ctx;
};

const KEY = 'cargo-marketplace-basket';

export const BasketProvider = ({ children }) => {
  const [basket, setBasket] = useState(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(basket)); } catch { /* quota / private mode — non-fatal */ }
  }, [basket]);

  const clearBasket = () => setBasket([]);
  const basketUnits = basket.reduce((s, l) => s + (Number(l.qty) || 0), 0);

  return (
    <BasketContext.Provider value={{ basket, setBasket, clearBasket, basketUnits }}>
      {children}
    </BasketContext.Provider>
  );
};

export default BasketContext;
