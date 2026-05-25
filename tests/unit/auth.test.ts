import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getUser,
  isAuthenticated,
  openLogin,
  onAuthChange,
} from '../../src/lib/auth';
import type { TxidUser } from '../../src/lib/auth';

const mockUser: TxidUser = {
  authenticated: true,
  pubkey: 'npub1test',
  displayName: 'Test User',
};

beforeEach(() => {
  // Reset window.txidAuth before each test
  delete (window as any).txidAuth;
});

afterEach(() => {
  delete (window as any).txidAuth;
});

describe('auth', () => {
  it('getUser returns null when SDK is not loaded', () => {
    expect(getUser()).toBeNull();
  });

  it('getUser returns user from window.txidAuth when available', () => {
    (window as any).txidAuth = {
      getUser: () => mockUser,
      openLogin: vi.fn(),
      getCsrfToken: () => null,
      onAuthChange: vi.fn(),
    };
    expect(getUser()).toEqual(mockUser);
  });

  it('isAuthenticated returns false when SDK is not loaded', () => {
    expect(isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns false when user is not authenticated', () => {
    (window as any).txidAuth = {
      getUser: () => ({ authenticated: false, pubkey: 'npub1test' }),
      openLogin: vi.fn(),
      getCsrfToken: () => null,
      onAuthChange: vi.fn(),
    };
    expect(isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns true when user is authenticated', () => {
    (window as any).txidAuth = {
      getUser: () => mockUser,
      openLogin: vi.fn(),
      getCsrfToken: () => null,
      onAuthChange: vi.fn(),
    };
    expect(isAuthenticated()).toBe(true);
  });

  it('openLogin calls txidAuth.openLogin when SDK is available', () => {
    const openLoginMock = vi.fn();
    (window as any).txidAuth = {
      getUser: () => null,
      openLogin: openLoginMock,
      getCsrfToken: () => null,
      onAuthChange: vi.fn(),
    };
    openLogin();
    expect(openLoginMock).toHaveBeenCalledOnce();
  });

  it('openLogin does nothing when SDK is not loaded (no error thrown)', () => {
    expect(() => openLogin()).not.toThrow();
  });

  it('onAuthChange registers callback when SDK is available', () => {
    const onAuthChangeMock = vi.fn();
    (window as any).txidAuth = {
      getUser: () => null,
      openLogin: vi.fn(),
      getCsrfToken: () => null,
      onAuthChange: onAuthChangeMock,
    };
    const cb = vi.fn();
    onAuthChange(cb);
    expect(onAuthChangeMock).toHaveBeenCalledWith(cb);
  });

  it('onAuthChange does nothing when SDK is not loaded (no error thrown)', () => {
    const cb = vi.fn();
    expect(() => onAuthChange(cb)).not.toThrow();
  });
});
