// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { addFuelLog } from '@/data/repositories/fuelRepository';
import { addOdometerLog } from '@/data/repositories/odometerRepository';
import { LogEntryForm } from './LogEntryForm';
import { UpdateOdometerSheet } from '../sheets/UpdateOdometerSheet';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/data/repositories/fuelRepository', () => ({
  addFuelLog: vi.fn(),
  updateFuelLog: vi.fn(),
}));
vi.mock('@/data/repositories/odometerRepository', () => ({ addOdometerLog: vi.fn() }));
vi.mock('@/components/layout/SyncStatusBadge', () => ({ SyncStatusBadge: () => null }));
vi.mock('@/components/ui/switch', () => ({ Switch: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('log-entry contract feedback', () => {
  it.each([
    ['log-odometer', '100000000', 'logEntry.odometerRange'],
    ['log-liters', '10000', 'logEntry.invalidLiters'],
    ['log-note', '😀'.repeat(501), 'logEntry.noteTooLong'],
  ])('rejects invalid %s with field feedback', async (id, value, error) => {
    const { container } = render(
      <LogEntryForm
        accountId="account"
        vehicleId="vehicle"
        currentOdometerKm={null}
        partTypes={[]}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(document.getElementById(id)!, { target: { value } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(error)).toBeTruthy());
    expect(document.getElementById(id)?.getAttribute('aria-invalid')).toBe('true');
    expect(addFuelLog).not.toHaveBeenCalled();
  });

  it('permits fractional KM/liters and uses step=any rather than blocking server rounding', async () => {
    const { container } = render(
      <LogEntryForm
        accountId="account"
        vehicleId="vehicle"
        currentOdometerKm={null}
        partTypes={[]}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    for (const id of ['log-odometer', 'log-liters']) {
      expect(document.getElementById(id)?.getAttribute('step')).toBe('any');
      fireEvent.change(document.getElementById(id)!, { target: { value: '123.456' } });
    }
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() =>
      expect(addFuelLog).toHaveBeenCalledWith(
        expect.objectContaining({ odometerKm: 123.456, liters: 123.456 }),
      ),
    );
  });
});

describe('odometer sheet contract feedback', () => {
  it('shows range feedback without writing an excessive reading', async () => {
    render(
      <UpdateOdometerSheet
        open
        onOpenChange={vi.fn()}
        accountId="account"
        vehicleId="vehicle"
        currentOdometerKm={null}
      />,
    );
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'odometer.saveReading' }));
    await waitFor(() => expect(screen.getByText('logEntry.odometerRange')).toBeTruthy());
    expect(addOdometerLog).not.toHaveBeenCalled();
  });

  it('still permits a fractional lower reading after explicit confirmation', async () => {
    render(
      <UpdateOdometerSheet
        open
        onOpenChange={vi.fn()}
        accountId="account"
        vehicleId="vehicle"
        currentOdometerKm={200}
      />,
    );
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '123.456' } });
    fireEvent.click(screen.getByRole('button', { name: 'odometer.saveReading' }));
    expect(addOdometerLog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'logEntry.saveAnyway' }));
    await waitFor(() =>
      expect(addOdometerLog).toHaveBeenCalledWith(expect.objectContaining({ odometerKm: 123.456 })),
    );
  });
});
