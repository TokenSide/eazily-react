import { translate } from '../../lib/translate.js';

export function UserBusyLabel({ children = 'Please wait…' }) {
  return <span className="user-button-progress" role="status">
    <span className="user-button-spinner" aria-hidden="true" />
    <span>{translate(children)}</span>
  </span>;
}

function SkeletonCard() {
  return <article className="vendor-card user-skeleton-card" aria-hidden="true">
    <div className="user-skeleton-head">
      <i className="user-skeleton-block user-skeleton-avatar" />
      <span>
        <i className="user-skeleton-block user-skeleton-title" />
        <i className="user-skeleton-block user-skeleton-short" />
      </span>
    </div>
    <i className="user-skeleton-block user-skeleton-line" />
    <i className="user-skeleton-block user-skeleton-line short" />
    <i className="user-skeleton-block user-skeleton-button" />
  </article>;
}

export function UserVendorSkeleton({ count = 2, rail = false }) {
  return <div className={`${rail ? 'professional-scroll' : 'vendor-list'} user-skeleton-list`} aria-busy="true" role="status">
    <span className="user-sr-only">{translate('Loading professionals…')}</span>
    {Array.from({ length: count }, (_, index) => <SkeletonCard key={index} />)}
  </div>;
}

export function UserOfferingSkeleton({ count = 2 }) {
  return <div className="user-offering-skeleton" aria-busy="true" role="status">
    <span className="user-sr-only">{translate('Loading offerings…')}</span>
    {Array.from({ length: count }, (_, index) => <div className="choice user-skeleton-choice" aria-hidden="true" key={index}>
      <span>
        <i className="user-skeleton-block user-skeleton-title" />
        <i className="user-skeleton-block user-skeleton-line" />
      </span>
      <i className="user-skeleton-block user-skeleton-short" />
    </div>)}
  </div>;
}

export function UserPanelSkeleton() {
  return <div className="user-panel-skeleton" aria-busy="true" role="status">
    <span className="user-sr-only">{translate('Loading account information…')}</span>
    <i className="user-skeleton-block user-skeleton-title" aria-hidden="true" />
    <i className="user-skeleton-block user-skeleton-line" aria-hidden="true" />
    <i className="user-skeleton-block user-skeleton-line short" aria-hidden="true" />
  </div>;
}
