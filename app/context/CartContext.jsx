import {createContext, useContext, useState, useCallback} from 'react';

const defaultCtx = {
  items: [],
  isOpen: false,
  setIsOpen: () => {},
  addItem: () => {},
  removeItem: () => {},
  updateQty: () => {},
  totalCount: 0,
  totalPrice: 0,
};

const CartContext = createContext(defaultCtx);

export function CartProvider({children}) {
  const [items, setItems] = useState([]);
  const [isOpen, setIsOpen] = useState(false);

  const addItem = useCallback((product) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.handle === product.handle);
      if (existing) {
        return prev.map((i) =>
          i.handle === product.handle ? {...i, qty: i.qty + 1} : i,
        );
      }
      return [...prev, {...product, qty: 1}];
    });
    setIsOpen(true);
  }, []);

  const removeItem = useCallback((handle) => {
    setItems((prev) => prev.filter((i) => i.handle !== handle));
  }, []);

  const updateQty = useCallback((handle, delta) => {
    setItems((prev) =>
      prev
        .map((i) => (i.handle === handle ? {...i, qty: i.qty + delta} : i))
        .filter((i) => i.qty > 0),
    );
  }, []);

  const totalCount = items.reduce((sum, i) => sum + i.qty, 0);
  const totalPrice = items.reduce((sum, i) => sum + i.priceNum * i.qty, 0);

  return (
    <CartContext.Provider
      value={{items, isOpen, setIsOpen, addItem, removeItem, updateQty, totalCount, totalPrice}}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
