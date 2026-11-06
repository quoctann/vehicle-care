// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useGoogleCallback } from './useGoogleCallback';

afterEach(cleanup);

function Feedback() {
  const result = useGoogleCallback();
  const location = useLocation();
  return (
    <>
      <p role="status" aria-label="feedback">
        {result.error ?? (result.linked ? 'linked' : 'none')}
      </p>
      <output aria-label="location">{location.pathname + location.search + location.hash}</output>
      <output aria-label="router state">{JSON.stringify(location.state)}</output>
    </>
  );
}

it('replaces callback query while retaining feedback, route, fragment and router state', async () => {
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/settings',
          search: '?google=linked&code=secret&state=secret&tab=account',
          hash: '#security',
          state: { returnTo: '/settings' },
        },
      ]}
    >
      <Feedback />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText('location').textContent).toBe('/settings?tab=account#security'),
  );
  expect(screen.getByRole('status', { name: 'feedback' }).textContent).toBe('linked');
  expect(screen.getByLabelText('router state').textContent).toBe('{"returnTo":"/settings"}');
});

it('keeps clean auth routes unchanged', async () => {
  render(
    <MemoryRouter initialEntries={['/sign-in?next=keep']}>
      <Feedback />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText('location').textContent).toBe('/sign-in?next=keep');
  expect(screen.getByRole('status', { name: 'feedback' }).textContent).toBe('none');
});
