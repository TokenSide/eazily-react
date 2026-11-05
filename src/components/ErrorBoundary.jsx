import { Component } from 'react';
import { translate } from '../lib/translate.js';
import Icon from './Icon.jsx';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    const { children, label = translate('this screen') } = this.props;
    if (!error) return children;
    return <main className="error-fallback" role="alert">
      <span className="error-fallback-icon"><Icon name="alert" size={30} /></span>
      <h1>{translate('Something went wrong')}</h1>
      <p>{translate('We could not load')} {label}. {translate('Your work is saved — please try again.')}</p>
      <div className="error-actions">
        <button type="button" className="btn btn-primary" onClick={this.reset}>{translate('Try again')}</button>
        <button type="button" className="btn btn-outline" onClick={() => location.reload()}>{translate('Reload app')}</button>
      </div>
      <details className="error-detail">
        <summary>{translate('Technical details')}</summary>
        <code>{translate(String(error?.message || error))}</code>
      </details>
    </main>;
  }
}