const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const asUser = async id => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)", [id]);
    await db.exec('set role authenticated');
  };
  const addAccount = async () => {
    const id = randomUUID();
    await db.exec('reset role');
    await db.query('insert into auth.users(id,phone) values($1,$2)', [id, id]);
    await db.query("update profiles set full_name='Test account',phone=$2 where id=$1", [id, id]);
    return id;
  };
  try {
    await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,phone text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;alter default privileges in schema public grant all on tables to authenticated,anon;alter default privileges in schema public grant all on sequences to authenticated,anon;");
    for (const file of ['schema', 'experience', 'wallet', 'partners', 'operations', 'influencer_legal_2026_09_12', 'staging_prelaunch_foundations', 'consultant_assessments']) {
      await db.exec(readFileSync(`supabase/${file}.sql`, 'utf8'));
    }

    assert.equal(Number(await scalar("select count(*) from legal_documents where document_key in('eazily-influencer-provider-terms','eazily-influencer-provider-privacy-policy') and version='2026-09-12' and published")), 0);
    assert.equal(Number(await scalar("select count(*) from regexp_matches((select content from legal_documents where document_key='eazily-influencer-provider-terms'),E'(?m)^([0-9]+)\\. [A-Z]','g')")), 21);
    assert.equal(Number(await scalar("select count(*) from regexp_matches((select content from legal_documents where document_key='eazily-influencer-provider-privacy-policy'),E'(?m)^([0-9]+)\\. [A-Z]','g')")), 19);

    const influencer = await addAccount();
    await asUser(influencer);
    const influencerDetails = { name: 'Fictional Creator', creatorName: 'Sample Creator', email: 'sample@example.invalid', city: 'Bhopal', pinCode: '462001', language: 'English', platforms: [{ name: 'Instagram', url: 'https://example.invalid/sample' }], insightScreenshots: ['private/sample'], aadhaar: ['private/sample'], accountNumber: '1', accountConfirmation: '1', consent: { termsAccepted: true, informationAccurate: true, documentId: 'wrong-document', version: '2026-09-12', acceptedAt: '2000-01-01T00:00:00Z' } };
    const influencerApp = await scalar("select to_jsonb(save_partner_application('influencer',$1,false))", [influencerDetails]);
    await assert.rejects(db.query("select save_partner_application('influencer',$1,true)", [influencerDetails]), /Explicit acceptance/);
    influencerDetails.consent.documentId = 'eazily-influencer-provider-terms';
    await assert.rejects(db.query("select save_partner_application('influencer',$1,true)", [influencerDetails]), /not published/);
    assert.equal(Number(await scalar("select count(*) from consent_events where partner_application_id=$1 and consent_type='eazily-influencer-provider-terms'", [influencerApp.id])), 0);
    await assert.rejects(db.query("select accept_influencer_terms($1,'wrong-document','2026-09-12')", [influencerApp.id]), /required Influencer Terms/);
    await assert.rejects(db.query("select accept_influencer_terms($1,'eazily-influencer-provider-terms','2026-09-12')", [influencerApp.id]), /not published/);

    const reviewer = influencer;
    await db.exec('reset role');
    const bank = await scalar("insert into consultant_assessment_banks(field_id,category,specialisation,version,approved,active,reviewed_by,reviewed_at) values(consultant_field_id('Career','Career Guidance'),'Career','Career Guidance','test-reviewed-v1',true,true,$1,now()) returning id", [reviewer]);
    const options = [{ id: 'a', label_en: 'Correct', label_hi: 'सही' }, { id: 'b', label_en: 'Option B', label_hi: 'विकल्प बी' }, { id: 'c', label_en: 'Option C', label_hi: 'विकल्प सी' }, { id: 'd', label_en: 'Option D', label_hi: 'विकल्प डी' }];
    for (let index = 0; index < 6; index += 1) {
      const difficulty = index < 2 ? 'foundation' : index < 5 ? 'standard' : 'advanced';
      await db.query("insert into consultant_assessment_questions(bank_id,question_code,difficulty,prompt_en,prompt_hi,options,correct_option_id,explanation_en,explanation_hi,approved) values($1,$2,$3,$4,$5,$6,'a','Reviewed explanation','समीक्षित व्याख्या',true)", [bank, `career-${index + 1}`, difficulty, `Reviewed Career Guidance question ${index + 1}`, `समीक्षित करियर मार्गदर्शन प्रश्न ${index + 1}`, options]);
    }

    async function candidateAttempt(correctAnswers, submitAfter = 6, extraFields = null) {
      const account = await addAccount();
      await asUser(account);
      const details = { name: 'Consultant Candidate', city: 'Bhopal', pinCode: '462001', language: 'English', category: 'Career', specialisation: 'Career Guidance', qualificationName: 'Career certification', qualifications: ['private/certificate'], aadhaar: ['private/aadhaar'], pan: ['private/pan'], accountNumber: '1', accountConfirmation: '1', ...extraFields };
      const app = await scalar("select to_jsonb(save_partner_application('consultant',$1,false))", [details]);
      const attempt = await scalar("select start_or_resume_consultant_assessment($1,'Career','Career Guidance','English')", [app.id]);
      assert.equal(attempt.questions.length, 6);
      assert.ok(!JSON.stringify(attempt).includes('correct_option_id'));
      await assert.rejects(db.query('select * from consultant_assessment_questions'), /permission denied/, 'Candidate cannot read answer keys directly');
      for (let index = 0; index < submitAfter; index += 1) {
        await db.query('select save_consultant_assessment_answer($1,$2,$3)', [attempt.attemptId, attempt.questions[index].id, index < correctAnswers ? 'a' : 'b']);
      }
      const resumed = await scalar("select start_or_resume_consultant_assessment($1,'Career','Career Guidance','English')", [app.id]);
      assert.deepEqual(resumed.questions.map(question => question.id), attempt.questions.map(question => question.id), 'Refresh restores the same question order');
      assert.equal(Object.keys(resumed.responses).length, submitAfter, 'Saved responses resume after technical interruption');
      return { account, app, attempt, details };
    }

    const incomplete = await candidateAttempt(5, 5);
    await assert.rejects(db.query('select submit_consultant_assessment($1)', [incomplete.attempt.attemptId]), /All six/);
    for (const expected of [3, 4, 5, 6]) {
      const sample = await candidateAttempt(expected);
      const result = await scalar('select submit_consultant_assessment($1)', [sample.attempt.attemptId]);
      assert.equal(result.correctCount, expected);
      assert.equal(result.status, expected >= 4 ? 'passed' : 'not_passed');
      if (expected >= 4) {
        sample.details.consent = { termsAccepted: true, informationAccurate: true, version: 'consultant-test', acceptedAt: new Date().toISOString() };
        const submitted = await scalar("select to_jsonb(save_partner_application('consultant',$1,true))", [sample.details]);
        assert.equal(submitted.status, 'submitted');
      } else {
        await db.exec('reset role');
        await assert.rejects(db.query("update partner_applications set status='approved' where id=$1", [sample.app.id]), /passed six-question assessment/);
      }
    }

    const skipped = await candidateAttempt(0, 0);
    skipped.details.assessmentStatus = 'skipped_for_testing';
    skipped.details.consent = { termsAccepted: true, informationAccurate: true, version: 'consultant-test', acceptedAt: new Date().toISOString() };
    await asUser(skipped.account);
    await assert.rejects(db.query("select save_partner_application('consultant',$1,true)", [skipped.details]), /passed six-question assessment/);

    const multi = await candidateAttempt(6, 6, { consultationFields: [{ category: 'Career', specialisation: 'Career Guidance' }, { category: 'Legal', specialisation: 'Contract Review' }] });
    await db.query('select submit_consultant_assessment($1)', [multi.attempt.attemptId]);
    multi.details.consent = { termsAccepted: true, informationAccurate: true, version: 'consultant-test', acceptedAt: new Date().toISOString() };
    await assert.rejects(db.query("select save_partner_application('consultant',$1,true)", [multi.details]), /every selected Consultant field/);

    await db.exec('reset role');
    await db.exec(readFileSync('supabase/consultant_legal.sql', 'utf8'));
    await db.exec(readFileSync('supabase/consultant_legal_drafts_2026_09_20.sql', 'utf8'));
    const legallyBlocked = await candidateAttempt(6);
    await db.query('select submit_consultant_assessment($1)', [legallyBlocked.attempt.attemptId]);
    legallyBlocked.details.consent = { termsAccepted: true, informationAccurate: true, version: 'consultant-test', acceptedAt: new Date().toISOString() };
    await assert.rejects(db.query("select save_partner_application('consultant',$1,true)", [legallyBlocked.details]), /Consultant Terms acceptance/);
    await db.exec('reset role');
    for (const kind of ['terms', 'privacy_policy']) {
      await db.query("insert into legal_documents(kind,language,version,title,content,published,effective_at,document_key,consultant_complete,consultant_approved_by,consultant_approved_at) values($1,'English','integration-fixture','TEST ONLY','Synthetic complete fixture',true,'2020-01-01',$2,true,$3,now())", [kind, `eazily-consultant-provider-${kind === 'terms' ? 'terms' : 'privacy-policy'}`, reviewer]);
    }
    await asUser(legallyBlocked.account);
    const currentPolicies = await scalar('select get_consultant_legal_status($1)', [legallyBlocked.app.id]);
    await db.query('select accept_consultant_policies($1,$2,true,true)', [legallyBlocked.app.id, currentPolicies.documents.map(doc => ({ id: doc.id, version: doc.version }))]);
    const legallySubmitted = await scalar("select to_jsonb(save_partner_application('consultant',$1,true))", [legallyBlocked.details]);
    assert.equal(legallySubmitted.status, 'submitted', 'Assessment pass plus both current acknowledgments permits submission');
    console.log('PASS: unresolved Influencer legal drafts reject consent; Consultant assessment and legal gates remain enforced.');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
