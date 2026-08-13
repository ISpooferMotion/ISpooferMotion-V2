import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeId,
  loadCachedUsers,
  mergeCachedUser,
  loadCachedGroups,
  saveCachedGroups,
  detectCookie,
  validateCookieProfile,
  type RobloxUserInfo,
} from './robloxProfiles';
import { invoke } from '@tauri-apps/api/core';

describe('robloxProfiles', () => {
  const storeData: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: vi.fn((key: string) => storeData[key] || null),
    setItem: vi.fn((key: string, val: string) => {
      storeData[key] = val;
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(storeData)) delete storeData[k];
    }),
  };

  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage);
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes IDs correctly', () => {
    expect(normalizeId(123)).toBe('123');
    expect(normalizeId(' 456 ')).toBe('456');
    expect(normalizeId(null)).toBe('');
    expect(normalizeId(undefined)).toBe('');
  });

  describe('User Caching', () => {
    it('loads empty array if cache is empty', () => {
      expect(loadCachedUsers()).toEqual([]);
    });

    it('saves and merges users correctly', () => {
      const user1: RobloxUserInfo = {
        id: 1,
        name: 'User1',
        displayName: 'User1',
        authType: 'cookie',
      };
      const user2: RobloxUserInfo = {
        id: 2,
        name: 'User2',
        displayName: 'User2',
        authType: 'cookie',
      };

      mergeCachedUser(user1);
      let users = loadCachedUsers();
      expect(users).toHaveLength(1);
      expect(users[0].id).toBe(1);

      // Adding the same user shouldn't duplicate
      mergeCachedUser(user1);
      users = loadCachedUsers();
      expect(users).toHaveLength(1);

      // Adding a new user should append
      mergeCachedUser(user2);
      users = loadCachedUsers();
      expect(users).toHaveLength(2);
    });
  });

  describe('Group Caching', () => {
    it('loads empty array for none or missing userId', () => {
      expect(loadCachedGroups('none')).toEqual([]);
      expect(loadCachedGroups('')).toEqual([]);
    });

    it('saves and loads groups correctly', () => {
      const groups = [{ id: 10, name: 'Group1' }];
      saveCachedGroups('123', groups);

      const loaded = loadCachedGroups('123');
      expect(loaded).toHaveLength(1);
      expect(loaded[0].name).toBe('Group1');
    });
  });

  describe('detectCookie', () => {
    it('invokes browser detection', async () => {
      (invoke as any).mockResolvedValueOnce('browser_cookie');
      const result = await detectCookie('browser');
      expect(invoke).toHaveBeenCalledWith('get_cookie_from_auto_detect', { userId: null });
      expect(result).toBe('browser_cookie');
    });

    it('invokes studio detection', async () => {
      (invoke as any).mockResolvedValueOnce('studio_cookie');
      const result = await detectCookie('studio', '123');
      expect(invoke).toHaveBeenCalledWith('get_cookie_from_roblox_studio', { userId: '123' });
      expect(result).toBe('studio_cookie');
    });

    it('returns null if invocation fails', async () => {
      (invoke as any).mockRejectedValueOnce(new Error('Failed'));
      const result = await detectCookie('studio');
      expect(result).toBeNull();
    });
  });

  describe('validateCookieProfile', () => {
    it('throws error if cookie is empty', async () => {
      await expect(validateCookieProfile('   ')).rejects.toThrow('No cookie was provided');
    });

    it('fetches user info and merges to cache', async () => {
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === 'get_authenticated_user_id') return Promise.resolve('123');
        if (cmd === 'get_roblox_user_info')
          return Promise.resolve({ id: 123, name: 'TestUser', displayName: 'Test' });
        if (cmd === 'get_roblox_user_avatar') return Promise.resolve('avatar_url');
        return Promise.resolve(null);
      });

      const result = await validateCookieProfile('test_cookie');
      expect(result.cookie).toBe('test_cookie');
      expect(result.user.id).toBe(123);
      expect(result.user.avatarUrl).toBe('avatar_url');
      expect(result.user.authType).toBe('cookie');

      const cached = loadCachedUsers();
      expect(cached).toHaveLength(1);
      expect(cached[0].name).toBe('TestUser');
    });
  });
});
