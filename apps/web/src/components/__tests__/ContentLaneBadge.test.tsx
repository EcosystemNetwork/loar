/**
 * Component tests for ContentLaneBadge — the fan / creator-owned /
 * rights-cleared marker shown on gallery + discover cards.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentLaneBadge } from '../ContentLaneBadge';

describe('ContentLaneBadge', () => {
  it('fan → "Non-Commercial"', () => {
    render(<ContentLaneBadge classification="fan" />);
    expect(screen.getByText('Non-Commercial')).toBeInTheDocument();
  });

  it('original → "Creator-Owned"', () => {
    render(<ContentLaneBadge classification="original" />);
    expect(screen.getByText('Creator-Owned')).toBeInTheDocument();
  });

  it('licensed + pending → "Pending Review"', () => {
    render(<ContentLaneBadge classification="licensed" reviewStatus="pending" />);
    expect(screen.getByText('Pending Review')).toBeInTheDocument();
  });

  it('licensed + rejected → "Review Failed"', () => {
    render(<ContentLaneBadge classification="licensed" reviewStatus="rejected" />);
    expect(screen.getByText('Review Failed')).toBeInTheDocument();
  });

  it('licensed + approved → "Rights-Cleared"', () => {
    render(<ContentLaneBadge classification="licensed" reviewStatus="approved" />);
    expect(screen.getByText('Rights-Cleared')).toBeInTheDocument();
  });

  it('licensed with the default reviewStatus falls back to "Rights-Cleared"', () => {
    render(<ContentLaneBadge classification="licensed" />);
    expect(screen.getByText('Rights-Cleared')).toBeInTheDocument();
  });

  it('size="sm" hides the text label but still renders the badge', () => {
    const { container } = render(<ContentLaneBadge classification="fan" size="sm" />);
    expect(screen.queryByText('Non-Commercial')).not.toBeInTheDocument();
    expect(container.firstChild).not.toBeNull();
  });
});
