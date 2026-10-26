import { describe, expect, it, vi } from 'vitest';
import { registerUpdates, type UpdateDependencies } from './registerUpdates';

function fixture() {
  const activate = vi.fn().mockResolvedValue(undefined);
  const dependencies: UpdateDependencies = {
    notify: vi.fn(),
    confirm: vi.fn().mockReturnValue(false),
    reload: vi.fn(),
    reportError: vi.fn(),
    schedule: vi.fn(),
    onForeground: vi.fn(),
  };
  const register = vi.fn().mockReturnValue(activate);
  registerUpdates(register, dependencies);
  return { dependencies, activate, callbacks: register.mock.calls[0]![0] };
}

describe('prompt service worker updates', () => {
  it('notifies without activating or reloading; cancellation preserves the page', async () => {
    const { dependencies, activate, callbacks } = fixture();
    callbacks.onNeedRefresh();
    expect(activate).not.toHaveBeenCalled();
    const accept = vi.mocked(dependencies.notify).mock.calls[0]![0];
    await accept();
    callbacks.onNeedReload();
    expect(activate).not.toHaveBeenCalled();
    expect(dependencies.reload).not.toHaveBeenCalled();
  });

  it('activates only after confirmation and reloads only the consenting tab', async () => {
    const { dependencies, activate, callbacks } = fixture();
    vi.mocked(dependencies.confirm).mockReturnValue(true);
    callbacks.onNeedRefresh();
    await vi.mocked(dependencies.notify).mock.calls[0]![0]();
    expect(activate).toHaveBeenCalledExactlyOnceWith(true);
    expect(dependencies.reload).not.toHaveBeenCalled();
    callbacks.onNeedReload();
    expect(dependencies.reload).toHaveBeenCalledOnce();
    const otherTab = fixture();
    otherTab.callbacks.onNeedReload();
    expect(otherTab.dependencies.reload).not.toHaveBeenCalled();
  });

  it('lets a deferred tab explicitly reload after another tab already activated', async () => {
    const { dependencies, activate, callbacks } = fixture();
    callbacks.onNeedRefresh();
    callbacks.onNeedReload();
    vi.mocked(dependencies.confirm).mockReturnValue(true);
    await vi.mocked(dependencies.notify).mock.calls[0]![0]();
    expect(dependencies.reload).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  });

  it('catches activation failure and revokes reload consent', async () => {
    const { dependencies, activate, callbacks } = fixture();
    vi.mocked(dependencies.confirm).mockReturnValue(true);
    activate.mockRejectedValue(new Error('activation failed'));
    callbacks.onNeedRefresh();
    await vi.mocked(dependencies.notify).mock.calls[0]![0]();
    callbacks.onNeedReload();
    expect(dependencies.reportError).toHaveBeenCalledOnce();
    expect(dependencies.reload).not.toHaveBeenCalled();
  });

  it('checks hourly and on foreground and handles rejected update checks', async () => {
    const { dependencies, callbacks } = fixture();
    callbacks.onRegisteredSW('/sw.js', undefined);
    expect(dependencies.schedule).not.toHaveBeenCalled();
    const update = vi.fn().mockRejectedValue(new Error('offline'));
    callbacks.onRegisteredSW('/sw.js', { update });
    expect(dependencies.schedule).toHaveBeenCalledWith(expect.any(Function), 3_600_000);
    await vi.mocked(dependencies.schedule).mock.calls[0]![0]();
    await vi.mocked(dependencies.onForeground).mock.calls[0]![0]();
    expect(update).toHaveBeenCalledTimes(2);
    expect(dependencies.reportError).toHaveBeenCalledTimes(2);
  });
});
