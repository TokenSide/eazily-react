import { Field } from '../../components/Ui.jsx';
import { translate as t } from '../../lib/translate.js';
import { consultantCategories, displayConsultantCategory } from '../../data/consultantCategories.js';
import MediaUpload from './MediaUpload.jsx';

export default function PartnerFields({ role, values, setValues, profile = {}, offerings = [] }) {
  const set = name => e => setValues(v => ({ ...v, [name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const field = (name, label, props = {}) => <Field key={name} label={t(label)} value={values[name] ?? ''} onChange={set(name)} {...props} />;
  const offering = values.postType === 'offering', offer = values.postType === 'offer';
  const registeredConsultantCategories = [...new Set([profile.category, ...(profile.consultationFields || []).map(item => item.category), values.category].filter(Boolean))]
    .sort((a, b) => (consultantCategories.indexOf(displayConsultantCategory(a)) + 1 || Infinity) - (consultantCategories.indexOf(displayConsultantCategory(b)) + 1 || Infinity));
  return <>
    <section className="policy-note"><b>{profile.businessName || profile.creatorName || profile.name || t('Partner profile')}</b><p>{role === 'consultant' ? displayConsultantCategory(profile.category) : profile.category} · {profile.city} · {profile.experience}</p><small>{t('Uses your saved registration. Private documents and bank details are never included in posts.')}</small></section>
    {role === 'consultant' ? <label className="field-wrap"><span>{t('Registered category')}</span><select className="field" value={values.category || ''} onChange={set('category')} required><option value="">{t('Select category')}</option>{registeredConsultantCategories.map(category => <option key={category} value={category}>{displayConsultantCategory(category)}</option>)}</select></label> : field('category', 'Registered category', { as: 'select', options: ['', ...new Set([profile.category].filter(Boolean))], required: true })}
    {role === 'professional' && field('service', 'Specific service', { as: 'select', options: ['', ...(profile.services || [])], required: offering })}
    {field('title', 'Title', { required: true, maxLength: 120 })}
    {field('description', 'Description', { as: 'textarea', required: true, maxLength: 4000 })}
    {!offering && <label className="field-wrap"><span>{t('Link an offering (optional)')}</span><select className="field" value={values.linkedPostId || ''} onChange={set('linkedPostId')}><option value="">{t('None')}</option>{offerings.map(p => <option key={p.id} value={p.id}>{p.details.title}</option>)}</select></label>}
    {offering && role === 'professional' && <>
      {field('pricingType', 'Pricing type', { as: 'select', options: ['Fixed Price', 'Starting Price', 'Inspection-Based Quote'], required: true })}
      {field('serviceCharge', 'Your service price (₹)', { type: 'number', min: 0, step: '.01', required: true })}
      {field('visitingCharge', 'Visiting charge (₹)', { type: 'number', min: 0, step: '.01', required: true })}
      {field('visitTreatment', 'Visiting charge treatment', { as: 'select', options: ['Additional', 'Included'], required: true })}
      {field('quantity', 'Quantity', { type: 'number', min: 1, max: 10000, required: true })}
      <label className="consent"><input type="checkbox" checked={!!values.taxInclusive} onChange={set('taxInclusive')} />{t('My entered prices include applicable GST')}</label>
      {field('inclusions', 'Inclusions', { as: 'textarea', required: true })}{field('exclusions', 'Exclusions', { as: 'textarea' })}{field('materials', 'Material charges')}
    </>}
    {offering && role === 'influencer' && <>
      <p>{t('Paid collaborations only. No barter. Prepaid booking.')}</p>
      {(profile.platforms || []).map((p, i) => <p key={i}>{p.name} · {p.url} · {p.count ?? t('Audience awaiting verification')} · {t('Self-reported')}</p>)}
      {field('deliverables', 'Deliverables', { as: 'select', options: ['Reel','Video','Story','Post','Review','Other'], required: true })}
      {field('deliverableCount', 'Number of deliverables', { type: 'number', min: 1, required: true })}
      {field('packagePrice', 'Your collaboration price (₹)', { type: 'number', min: '.01', step: '.01', required: true })}
      {field('audience', 'Audience information (optional)')}{field('timeline', 'Delivery timeline', { required: true })}{field('revisions', 'Included revisions', { type: 'number', min: 0 })}{field('usageRights', 'Content usage rights and advertising permissions', { as: 'textarea', required: true })}
      <p className="policy-note">{t('70% advance and 30% security hold apply to your agreed payout under the configured release terms. Posting does not transfer money.')}</p>
    </>}
    {offering && role === 'consultant' && <>
      <p>{profile.specialisation} · {profile.qualificationName}</p>
      {field('mode', 'Consultation mode', { as: 'select', options: ['Online consultation','Offline consultation','Both'], required: true })}
      {values.mode !== 'Online consultation' && field('offlineLocation','Offline consultation location',{ required: true })}
      {field('duration', 'Paid session duration (minutes)', { as: 'select', options: ['15','30','45','60'], required: true })}
      <p className="policy-note">{t('Eazily manages consultation pricing. Save a draft while rate assignment is pending.')}</p>
      <p>{t('Five-minute free introduction. Paid sessions require separate, explicit customer confirmation.')}</p>
    </>}
    {offer && <>{field('offerBenefit','Offer benefit',{ required: true })}{field('offerStarts','Starts',{ type:'datetime-local',required:true })}{field('offerEnds','Ends',{ type:'datetime-local',required:true })}{field('offerTerms','Offer conditions',{ as:'textarea',required:true })}<p>{t('Discounts require approval and do not change existing booking prices.')}</p></>}
    {field('area','Service area')}{offering && field('availability','Availability and future scheduling',{ required:true })}
    {field('hashtags','Hashtags (optional)')}
    <MediaUpload role={role} label={values.postType === 'video' ? 'Upload or record video' : 'Photos and videos'} value={values.media || []} onChange={change => setValues(v => ({ ...v, media: typeof change === 'function' ? change(v.media || []) : change }))} />
  </>;
}
