import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { messageLink, useLinkedMessage } from '../links';

describe('messageLink', () => {
  it('encodes the conversation and message', () => {
    expect(messageLink('a/b', 'm 1')).toBe('/c/a%2Fb?message=m%201');
    expect(messageLink('c1')).toBe('/c/c1');
  });
});

describe('useLinkedMessage', () => {
  let search = '';
  function Harness({ ready }: { ready: boolean }) {
    useLinkedMessage(ready);
    search = useLocation().search;
    return <div id="m1" />;
  }

  it('scrolls to the linked message once ready, then drops the parameter', async () => {
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { rerender } = render(
      <MemoryRouter initialEntries={['/c/c1?message=m1']}>
        <Harness ready={false} />
      </MemoryRouter>,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(
      <MemoryRouter initialEntries={['/c/c1?message=m1']}>
        <Harness ready />
      </MemoryRouter>,
    );
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    await waitFor(() => expect(search).toBe(''));
  });
});
