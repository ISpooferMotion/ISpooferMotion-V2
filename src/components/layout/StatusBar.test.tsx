import { render } from '@testing-library/react';
import StatusBar from './StatusBar';
import { describe, it } from 'vitest';

describe('StatusBar', () => {
  it('renders spacer cleanly', () => {
    render(<StatusBar />);
  });
});
