import { FormEvent, useState } from 'react';
import { addSource, type DiscoveredFeedChoice } from '../api';

const OPT_OUT_PROJECT_FEED = 'https://www.optoutproject.net/feed/';

export function AddSourceView({ onSourceAdded }: { onSourceAdded?: () => void | Promise<void> }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [choices, setChoices] = useState<DiscoveredFeedChoice[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitSource(sourceUrl: string) {
    setError(null);
    setMessage(null);
    setChoices([]);
    setIsSubmitting(true);
    try {
      const result = await addSource(sourceUrl);
      if (result.kind === 'choices') {
        setChoices(result.choices);
      } else {
        setMessage(`Added ${result.subscription.title ?? result.subscription.url}.`);
        setUrl('');
        void Promise.resolve(onSourceAdded?.()).catch(() => undefined);
      }
    } catch (sourceError) {
      setError(sourceError instanceof Error ? sourceError.message : 'Could not add that source.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitSource(url);
  }

  return (
    <section className="add-source-surface" aria-labelledby="add-source-heading">
      <div className="narrow-panel">
        <p className="section-kicker">Add Source</p>
        <h1 id="add-source-heading">Paste a site or feed URL.</h1>
        <p className="quiet-copy">Rill will use the feed directly or discover RSS, Atom, and JSON Feed links from the page.</p>
        <form className="source-form" onSubmit={handleSubmit}>
          <input
            aria-label="Source URL"
            placeholder="https://example.com"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
          <button className="accent-button" type="submit" disabled={isSubmitting || url.trim().length === 0}>Add</button>
        </form>
        <button className="ghost-button compact" type="button" onClick={() => void submitSource(OPT_OUT_PROJECT_FEED)}>
          Try Opt Out Project
        </button>
        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="success-message">{message}</p> : null}
        {choices.length > 0 ? (
          <div className="choice-list">
            <p className="quiet-copy">Multiple feeds found. Choose one:</p>
            {choices.map((choice) => (
              <button key={choice.url} type="button" className="choice-row" onClick={() => void submitSource(choice.url)}>
                <span>{choice.title ?? choice.url}</span>
                <span>{choice.type.toUpperCase()}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
