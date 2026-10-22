import { describe, expect, test } from 'bun:test';
import {
  RUNSIGNUP_WINDOW_END,
  RUNSIGNUP_WINDOW_START,
  requireRunSignupAuthorization,
} from '../../live/authorization';

describe('real signup authorization guard', () => {
  test('requires explicit opt-in', () => {
    expect(() => requireRunSignupAuthorization(undefined, RUNSIGNUP_WINDOW_START)).toThrow();
    expect(() => requireRunSignupAuthorization('0', RUNSIGNUP_WINDOW_START)).toThrow();
  });
  test('permits only the stated seven-day window', () => {
    expect(() => requireRunSignupAuthorization('1', RUNSIGNUP_WINDOW_START)).not.toThrow();
    expect(() => requireRunSignupAuthorization('1', RUNSIGNUP_WINDOW_END - 1)).not.toThrow();
    expect(() => requireRunSignupAuthorization('1', RUNSIGNUP_WINDOW_START - 1)).toThrow();
    expect(() => requireRunSignupAuthorization('1', RUNSIGNUP_WINDOW_END)).toThrow();
  });
});
