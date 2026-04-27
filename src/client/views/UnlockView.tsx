import { FormEvent, useState } from 'react';
import { unlock } from '../api';

interface UnlockViewProps {
  onUnlocked: () => void;
}

export function UnlockView({ onUnlocked }: UnlockViewProps) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await unlock(token);
      setToken('');
      onUnlocked();
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : 'Unlock failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="unlock-shell">
      <form className="unlock-card" onSubmit={handleSubmit}>
        <div className="unlock-wordmark">rill</div>
        <label htmlFor="token">Private token</label>
        <input
          id="token"
          name="token"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(event) => setToken(event.currentTarget.value)}
        />
        {error ? <p className="form-error">{error}</p> : null}
        <button className="accent-button" type="submit" disabled={isSubmitting || token.trim().length === 0}>
          {isSubmitting ? 'Unlocking' : 'Unlock'}
        </button>
      </form>
    </main>
  );
}
