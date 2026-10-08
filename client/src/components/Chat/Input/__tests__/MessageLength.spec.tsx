import React from 'react';
import { useForm } from 'react-hook-form';
import { render, screen } from '@testing-library/react';
import MessageLength from '../MessageLength';
import SendButton from '../SendButton';

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string, values?: Record<string, unknown>): string => {
      const template =
        (jest.requireActual('~/locales/en/translation.json') as Record<string, string>)[key] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
        values?.[name] != null ? String(values[name]) : match,
      );
    },
}));

function Composer({ text, max }: { text: string; max: number }) {
  const { control } = useForm<{ text: string }>({ defaultValues: { text } });
  return (
    <>
      <MessageLength control={control} max={max} />
      <SendButton control={control} disabled={false} maxLength={max} />
    </>
  );
}

const status = () => screen.getByRole('status');
const sendButton = () => screen.getByTestId('send-button');

describe('MessageLength', () => {
  it('shows nothing and allows sending well under the limit', () => {
    render(<Composer text="hello" max={100} />);

    expect(screen.queryByTestId('message-length')).not.toBeInTheDocument();
    expect(status()).toHaveTextContent('');
    expect(sendButton()).not.toBeDisabled();
  });

  it('shows the count near the limit without announcing it', () => {
    render(<Composer text={'x'.repeat(95)} max={100} />);

    expect(screen.getByTestId('message-length')).toHaveTextContent('95 of 100 characters');
    expect(screen.getByTestId('message-length')).toHaveAttribute('aria-hidden', 'true');
    expect(status()).toHaveTextContent('');
    expect(sendButton()).not.toBeDisabled();
  });

  it('blocks sending and announces it once a message is over the limit', () => {
    render(<Composer text={'x'.repeat(101)} max={100} />);

    expect(screen.getByTestId('message-length')).toHaveTextContent(
      '101 of 100 characters. Shorten your message to send it.',
    );
    expect(status()).toHaveTextContent(
      'Your message is over the 100-character limit. Shorten it to send it.',
    );
    expect(sendButton()).toBeDisabled();
  });

  it('counts an emoji as one character, as the server does', () => {
    render(<Composer text={'😀'.repeat(100)} max={100} />);

    expect(screen.getByTestId('message-length')).toHaveTextContent('100 of 100 characters');
    expect(sendButton()).not.toBeDisabled();
  });
});
