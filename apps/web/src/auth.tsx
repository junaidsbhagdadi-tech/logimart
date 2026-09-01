import { createContext, useContext, useState, ReactNode } from 'react';
import { api, setToken, clearToken, getToken } from './api';

interface User {
  id: string;
  fullName: string;
  role: string;
  clientId: string | null;
  hubId?: string | null;
  department?: string | null;
  featureGrants?: string[] | Record<string, 'VIEW' | 'EDIT' | 'DELETE'> | null;
}
interface AuthCtx {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

const USER_KEY = 'logimart_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    return getToken() && raw ? JSON.parse(raw) : null;
  });

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    setToken(res.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
  };

  const logout = () => {
    clearToken();
    localStorage.removeItem(USER_KEY);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>;
}
