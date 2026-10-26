// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPartType, updatePartTypeName } from '@/data/repositories/partTypeRepository';
import { PartTypeFormSheet } from './PartTypeFormSheet';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/data/repositories/partTypeRepository', () => ({
  createPartType: vi.fn(),
  updatePartTypeName: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('part-name UTF-8 form feedback', () => {
  it.each([false, true])(
    'rejects names exceeding 500 bytes before saving (editing=%s)',
    (editing) => {
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
      render(
        <PartTypeFormSheet
          open
          onOpenChange={vi.fn()}
          accountId="account"
          editingPartType={editing ? part : null}
        />,
      );
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ắ'.repeat(167) } });
      fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
      expect(screen.getByText('partType.invalidName')).toBeTruthy();
      expect(createPartType).not.toHaveBeenCalled();
      expect(updatePartTypeName).not.toHaveBeenCalled();
    },
  );
});
