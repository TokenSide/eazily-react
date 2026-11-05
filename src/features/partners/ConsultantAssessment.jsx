import { useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured } from '../../lib/supabase.js';
import { saveConsultantAssessmentAnswer, startConsultantAssessment, submitConsultantAssessment } from '../../services/partners.js';
import { CONSULTANT_ASSESSMENT_TEST_SKIP_ENABLED } from './consultantAssessmentConfig.js';
import { displayConsultantCategory } from '../../data/consultantCategories.js';

const TEST_SKIP_KEY = 'eazily-consultant-assessment-preview';

function messageFor(result) {
  if (result?.status === 'passed') return `You passed: ${result.correctCount}/6 correct`;
  if (result?.status === 'not_passed') return `You scored ${result.correctCount}/6. At least 4 correct answers are required.`;
  return '';
}

export default function ConsultantAssessment({ application, values, setValues, notify, onSkip, demo = false }) {
  const [assessment, setAssessment] = useState(null);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [loading, setLoading] = useState(Boolean(isSupabaseConfigured && !demo));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const language = values.language === 'हिन्दी' ? 'हिन्दी' : 'English';
  const fields = useMemo(() => values.consultationFields?.length
    ? values.consultationFields
    : [{ category: values.category, specialisation: values.specialisation }], [values.consultationFields, values.category, values.specialisation]);
  const field = fields[fieldIndex] || fields[0];

  useEffect(() => {
    let active = true;
    if (demo || !isSupabaseConfigured || !application?.id) {
      setLoading(false);
      setAssessment({ available: false, reason: demo ? 'Demo assessment uses sample data only. Skip for now opens the sample consultant dashboard without recording a pass.' : 'A configured assessment backend and six approved questions for this field are required. Local testing can use Skip for now; it never records a pass.' });
      return undefined;
    }
    setLoading(true);
    startConsultantAssessment(application.id, field?.category, field?.specialisation, language)
      .then(result => {
        if (!active) return;
        setAssessment(result);
        const firstUnanswered = result?.questions?.findIndex(question => !result.responses?.[question.id]);
        setQuestionIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
        setValues(current => ({ ...current, assessmentAttemptId: result?.attemptId || current.assessmentAttemptId, assessmentFieldId: result?.fieldId || current.assessmentFieldId, assessmentStatus: result?.status || current.assessmentStatus, assessmentResults: result?.fieldId ? { ...(current.assessmentResults || {}), [result.fieldId]: { status: result.status, attemptId: result.attemptId, version: result.version, score: result.correctCount } } : current.assessmentResults }));
      })
      .catch(nextError => { if (active) { setError(nextError.message); setAssessment(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [application?.id, field?.category, field?.specialisation, language, setValues, demo]);

  if (loading) return <section className="consultant-assessment"><p role="status">Restoring your assessment attempt…</p></section>;
  if (error) return <section className="consultant-assessment"><p className="inline-error" role="alert">{error}</p><button type="button" className="btn btn-outline" onClick={() => location.reload()}>Retry</button><TestingSkip onSkip={onSkip} demo={demo} /></section>;
  if (!assessment?.available) return <section className="consultant-assessment"><h3>{displayConsultantCategory(field?.category)} · {field?.specialisation}</h3><p className="testing-notice" role="status">Assessment unavailable: {assessment?.reason || 'Fewer than six approved questions are available for this field.'}</p><p>Your registration progress is preserved. Unrelated questions will not be substituted.</p><TestingSkip onSkip={onSkip} demo={demo} /></section>;

  const question = assessment.questions?.[questionIndex];
  const selected = assessment.responses?.[question?.id] || '';
  const resultMessage = messageFor(assessment);
  if (resultMessage) return <section className={`consultant-assessment assessment-${assessment.status}`}><h3>{resultMessage}</h3>{assessment.status === 'passed' ? <><p>This field can proceed to Review and Consent. Credentials, documents, human approval, consent and an assigned rate remain separate requirements.</p>{fieldIndex < fields.length - 1 && <button type="button" className="btn btn-primary" onClick={() => { setAssessment(null); setFieldIndex(index => index + 1); }}>Continue to next selected field</button>}</> : <p>This attempt did not pass. Retake eligibility: {assessment.retakeAvailable ? 'Available' : assessment.retakeMessage || 'Not currently available'}.</p>}</section>;

  async function select(optionId) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await saveConsultantAssessmentAnswer(assessment.attemptId, question.id, optionId);
      setAssessment(current => ({ ...current, responses: result.responses }));
    } catch (nextError) { setError(nextError.message); notify(nextError.message); }
    finally { setBusy(false); }
  }

  async function finish() {
    if (Object.keys(assessment.responses || {}).length !== 6) { setError('Answer all six questions before submitting the assessment.'); return; }
    setBusy(true); setError('');
    try {
      const result = await submitConsultantAssessment(assessment.attemptId);
      setAssessment(current => ({ ...current, ...result }));
      setValues(current => ({ ...current, assessmentAttemptId: assessment.attemptId, assessmentFieldId: assessment.fieldId, assessmentStatus: result.status, assessmentScore: result.correctCount, assessmentResults: { ...(current.assessmentResults || {}), [assessment.fieldId]: { status: result.status, attemptId: assessment.attemptId, version: result.version, score: result.correctCount } } }));
    } catch (nextError) { setError(nextError.message); notify(nextError.message); }
    finally { setBusy(false); }
  }

  return <section className="consultant-assessment">
    <p className="eyebrow">{displayConsultantCategory(field.category)} · {field.specialisation}</p>
    <h3>Question {questionIndex + 1} of 6</h3>
    <p>{question?.prompt}</p>
    <div className="assessment-options" role="radiogroup" aria-label={`Answers for question ${questionIndex + 1}`}>
      {question?.options.map(option => <button type="button" role="radio" aria-checked={selected === option.id} className={selected === option.id ? 'selected' : ''} key={option.id} disabled={busy} onClick={() => select(option.id)}>{option.label}</button>)}
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="review-actions"><button type="button" className="btn btn-outline" disabled={!questionIndex || busy} onClick={() => setQuestionIndex(index => index - 1)}>Back</button>{questionIndex < 5 ? <button type="button" className="btn btn-primary" disabled={!selected || busy} onClick={() => setQuestionIndex(index => index + 1)}>Next</button> : <button type="button" className="btn btn-primary" disabled={!selected || busy} onClick={finish}>{busy ? 'Checking…' : 'Submit assessment'}</button>}</div>
  </section>;
}

function TestingSkip({ onSkip, demo }) {
  if (!CONSULTANT_ASSESSMENT_TEST_SKIP_ENABLED || (isSupabaseConfigured && !demo)) return null;
  return <div className="assessment-test-skip"><small>Testing only</small><button type="button" className="btn btn-outline" onClick={() => {
    const marker = { status: 'skipped_for_testing', savedAt: new Date().toISOString() };
    if (!demo) sessionStorage.setItem(TEST_SKIP_KEY, JSON.stringify(marker));
    onSkip(marker);
  }}>Skip for now</button></div>;
}
