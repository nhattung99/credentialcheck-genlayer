import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    console.error('CredentialCheck UI error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="crash-screen">
          <div className="crash-card">
            <AlertTriangle size={28} />
            <h2>Something went wrong</h2>
            <p>The page stayed up. Reload to keep looking up or submitting a credential.</p>
            {this.state.error && <pre>{String(this.state.error)}</pre>}
            <button className="btn-primary" type="button" onClick={() => window.location.reload()}>
              <RefreshCw size={16} /> Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
