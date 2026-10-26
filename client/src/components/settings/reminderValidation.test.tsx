// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createReminderConfig } from '@/data/repositories/reminderRepository';
import { ReminderEditor } from './ReminderEditor';
import { ReminderManagement } from './ReminderManagement';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/data/repositories/reminderRepository', () => ({ createReminderConfig: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const part = {
  id: 'part',
  accountId: 'account',
  code: 'oil',
  displayName: 'Oil',
  displayOrder: 1,
  active: true,
  createdAtClient: '',
  serverSeq: null,
  serverSyncedAt: null,
};

describe('reminder numeric form validation', () => {
  it('still saves a genuinely blank optional interval as null', async () => {
    render(
      <ReminderEditor
        open
        onOpenChange={vi.fn()}
        accountId="account"
        vehicleId="vehicle"
        currentOdometerKm={10}
        partTypes={[part]}
        configuredPartTypeIds={new Set()}
      />,
    );
    fireEvent.change(document.getElementById('new-reminder-days')!, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'reminder.add' }));
    await waitFor(() =>
      expect(createReminderConfig).toHaveBeenCalledWith(
        expect.objectContaining({ intervalKm: null, intervalDays: 10, baselineOdometerKm: null }),
      ),
    );
  });
  it.each([
    ['new-reminder-km', 'reminder.intervalKmRange'],
    ['new-reminder-days', 'reminder.intervalDaysRange'],
    ['new-reminder-baseline-km', 'logEntry.odometerRange'],
  ])('create rejects browser badInput even when %s has an empty value', async (id, error) => {
    render(
      <ReminderEditor
        open
        onOpenChange={vi.fn()}
        accountId="account"
        vehicleId="vehicle"
        currentOdometerKm={10}
        partTypes={[part]}
        configuredPartTypeIds={new Set()}
      />,
    );
    fireEvent.change(document.getElementById('new-reminder-km')!, { target: { value: '100' } });
    fireEvent.change(document.getElementById('new-reminder-days')!, { target: { value: '10' } });
    const input = document.getElementById(id) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    Object.defineProperty(input.validity, 'badInput', { configurable: true, value: true });
    fireEvent.click(screen.getByRole('button', { name: 'reminder.add' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(error));
    expect(createReminderConfig).not.toHaveBeenCalled();
  });
  it.each([
    ['new-reminder-km', '-1', 'reminder.intervalKmRange'],
    ['new-reminder-km', '100000000', 'reminder.intervalKmRange'],
    ['new-reminder-days', '1.5', 'reminder.intervalDaysRange'],
    ['new-reminder-days', '2147483648', 'reminder.intervalDaysRange'],
    ['new-reminder-baseline-km', '-1', 'logEntry.odometerRange'],
  ])('create rejects %s=%s instead of dropping it', async (id, value, error) => {
    render(
      <ReminderEditor
        open
        onOpenChange={vi.fn()}
        accountId="account"
        vehicleId="vehicle"
        currentOdometerKm={10}
        partTypes={[part]}
        configuredPartTypeIds={new Set()}
      />,
    );
    fireEvent.change(document.getElementById('new-reminder-km')!, { target: { value: '100' } });
    fireEvent.change(document.getElementById('new-reminder-days')!, { target: { value: '10' } });
    fireEvent.change(document.getElementById(id)!, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'reminder.add' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(error));
    expect(createReminderConfig).not.toHaveBeenCalled();
  });

  it.each([
    ['reminder-km', '-1', 'reminder.intervalKmRange'],
    ['reminder-days', '1.5', 'reminder.intervalDaysRange'],
    ['reminder-km', 'badInput', 'reminder.intervalKmRange'],
    ['reminder-days', 'badInput', 'reminder.intervalDaysRange'],
  ])('edit rejects %s=%s while the other interval is valid', async (id, value, error) => {
    const onUpdate = vi.fn();
    render(
      <ReminderManagement
        vehicleName="Bike"
        reminders={[
          {
            partType: part,
            config: {
              id: 'reminder',
              accountId: 'account',
              vehicleId: 'vehicle',
              partTypeId: part.id,
              intervalKm: 100,
              intervalDays: 10,
              baselineOdometerKm: 0,
              baselineDate: null,
              enabled: true,
              deletedAt: null,
              createdAtClient: '',
              serverSeq: null,
              serverSyncedAt: null,
            },
            result: {
              status: 'insufficient_data',
              km: null,
              days: null,
              basis: { usedServiceLog: false },
            },
          },
        ]}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'reminder.editAria' }));
    const input = document.getElementById(id) as HTMLInputElement;
    fireEvent.change(input, { target: { value: value === 'badInput' ? '' : value } });
    if (value === 'badInput')
      Object.defineProperty(input.validity, 'badInput', { configurable: true, value: true });
    fireEvent.click(screen.getByRole('button', { name: 'reminder.saveChanges' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(error));
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
