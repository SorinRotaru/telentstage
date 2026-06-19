import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface AdminInfo {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: 'superadmin' | 'moderator' | 'support';
  avatar_url?: string | null;
}

interface AuthContextType {
  token: string;
  admin: AdminInfo | null;
  login: (token: string, admin: AdminInfo) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const safeGet = (key: string): string => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const safeSet = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage-denied environments
  }
};

const safeRemove = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage-denied environments
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => safeGet('admin_token'));
  const [admin, setAdmin] = useState<AdminInfo | null>(() => {
    try {
      const raw = safeGet('admin_info');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  const login = useCallback((t: string, a: AdminInfo) => {
    setToken(t);
    setAdmin(a);
    safeSet('admin_token', t);
    safeSet('admin_info', JSON.stringify(a));
  }, []);

  const logout = useCallback(() => {
    setToken('');
    setAdmin(null);
    safeRemove('admin_token');
    safeRemove('admin_info');
  }, []);

  return (
    <AuthContext.Provider value={{ token, admin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
