import { useEffect, useRef, useState } from 'react';
import { translate as t } from '../../lib/translate.js';

export default function MediaUpload({
  value = [],
  onChange,
  label = 'Photos and videos',
  documents = false,
  photosOnly = false,
  single = false,
  maxSizeMb = 50,
  // Opt-in (registration forms): start uploading as soon as a valid file is picked,
  // and offer the camera for document photos. Existing callers keep the manual Upload step.
  autoUpload = false,
  documentCamera = false,
}) {
  const [jobs, setJobs] = useState([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const allowed = photosOnly
    ? ['image/jpeg', 'image/png']
    : documents
      ? ['image/jpeg', 'image/png', 'application/pdf']
      : ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
  const accept = allowed.join(',');

  useEffect(() => () => jobsRef.current.forEach(job => job.preview && URL.revokeObjectURL(job.preview)), []);

  function addFiles(files) {
    const selected = [...files].slice(0, single ? 1 : 10);
    const entries = selected.map(file => {
      const unsupported = !allowed.includes(file.type);
      const tooLarge = file.size > maxSizeMb * 1024 * 1024;
      return {
        file,
        id: crypto.randomUUID(),
        status: unsupported ? 'Unsupported file type' : tooLarge ? `File exceeds ${maxSizeMb} MB` : 'Ready',
        invalid: unsupported || tooLarge,
        progress: 0,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      };
    });
    setJobs(current => {
      if (single) current.forEach(job => job.preview && URL.revokeObjectURL(job.preview));
      return single ? entries : [...current, ...entries].slice(0, 10);
    });
    if (autoUpload) entries.filter(entry => !entry.invalid).forEach(entry => upload(entry));
  }

  function removeJob(job) {
    if (job.preview) URL.revokeObjectURL(job.preview);
    setJobs(current => current.filter(item => item.id !== job.id));
  }

  async function upload(job) {
    const updateJob = patch => setJobs(rows => rows.map(row => row.id === job.id ? { ...row, ...patch } : row));
    updateJob({ status: 'Local sample only. File uploads are unavailable.', failed: true });
  }

  const formatLabel = photosOnly ? 'JPG or PNG' : documents ? 'JPG, PNG or PDF' : 'JPG, PNG, WebP, MP4 or WebM';
  return <section className="media-upload">
    <label className="field-wrap upload-picker">
      <span className="form-label">{t(single && value.length ? 'Replace file' : label)}</span>
      <small>{formatLabel} · Maximum {maxSizeMb} MB each · Upload one at a time if your connection is slow.</small>
      <input className="field" type="file" accept={accept} multiple={!single} onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
    </label>
    {(photosOnly || (documents && documentCamera)) && <label className="field-wrap upload-picker camera-picker">
      <span className="form-label">{t('Take a photo')}</span>
      <input className="field" type="file" accept="image/jpeg,image/png" capture="environment" onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
    </label>}
    {!documents && !photosOnly && <label className="field-wrap upload-picker camera-picker">
      <span>{t('Record Video')}</span>
      <input className="field" aria-label="Record Video" type="file" accept="video/mp4,video/webm" capture="environment" onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
    </label>}
    {jobs.map(job => <div className="upload-row upload-pending" key={job.id}>
      {job.preview && <img src={job.preview} alt="Selected file preview" />}
      <div className="upload-status"><span>{job.file.name}</span><small>{t(job.status)}</small><progress aria-label={`Upload progress for ${job.file.name}`} value={job.progress} max="100" /></div>
      <div className="upload-row-actions"><button type="button" className="link" onClick={() => removeJob(job)} disabled={job.status === 'Uploading'}>{t('Remove')}</button>{!(autoUpload && !job.failed && !job.invalid) && <button type="button" className="btn btn-outline" disabled={job.invalid || job.status === 'Uploading'} onClick={() => upload(job)}>{t(job.failed ? 'Retry upload' : 'Upload')}</button>}</div>
    </div>)}
    {value.map(item => <div className="upload-row upload-complete" key={item.path}>
      <div><span>{item.name}</span><small>Uploaded · Pending private review</small></div>
      <button type="button" className="link" onClick={() => onChange(current => current.filter(row => row.path !== item.path))}>{t('Remove')}</button>
    </div>)}
  </section>;
}
