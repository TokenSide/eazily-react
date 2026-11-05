import { translate } from "../../lib/translate.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Field, Sheet } from "../../components/Ui.jsx";
import Icon from "../../components/Icon.jsx";
import { bookPartnerOffering, createServiceRequest, getServiceBookingEstimate, getServiceMatchCapabilities, requestProfessionalBooking } from "../../services/marketplace.js";
import WalletCheckout from '../account/WalletCheckout.jsx';
import { UserBusyLabel } from '../user-motion/UserLoading.jsx';
const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
function SubmitButton({
  busy,
  children = "Submit request"
}) {
  return <button className="btn btn-primary full" type="submit" disabled={busy}>{busy ? <UserBusyLabel>Submitting…</UserBusyLabel> : translate(children)}</button>;
}
function FormGrid({
  children
}) {
  return <div className="form-grid">{translate(children)}</div>;
}
export default function RequestSheet({
  request,
  onClose,
  notify
}) {
  const submissionKey = useRef(crypto.randomUUID());
  const [values, setValues] = useState({
    transportMode: "Local",
    occupation: "",
    consent: false,
    servicePackage: "standard",
    shipmentSize: "1 BHK",
    description: request.requirement || "",
    address: request.address || "",
    city: request.city || "",
    backup: false
  });
  const [loanStep, setLoanStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [backupAvailable, setBackupAvailable] = useState(false);
  useEffect(() => {
    if (!request.partnerPostId || request.demo || ['influencers','consultancy'].includes(request.categoryId)) return undefined;
    let active = true;
    setEstimateLoading(true);
    getServiceBookingEstimate(request.partnerPostId).then(value => { if (active) setEstimate(value); })
      .catch(() => { if (active) setEstimate({ available: false, reason: 'Server price breakdown is unavailable.' }); })
      .finally(() => { if (active) setEstimateLoading(false); });
    getServiceMatchCapabilities().then(value => { if (active) setBackupAvailable(Boolean(value?.backupAvailable)); }).catch(() => {});
    return () => { active = false; };
  }, [request.partnerPostId, request.demo, request.categoryId]);
  const set = key => event => setValues(current => ({
    ...current,
    [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value
  }));
  const kind = useMemo(() => {
    if (request.categoryId === "loans") return "loan";
    if (request.categoryId === "transportation") return "transportation";
    if (request.categoryId === "blood-bank") return "blood";
    if (request.categoryId === "influencers") return "influencer";
    if (request.categoryId === "consultancy") return "consultancy";
    return "service";
  }, [request]);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (kind === "loan" && !values.consent) {
      notify("Please provide data consent to continue");
      return;
    }
    setBusy(true);
    try {
      if (request.demo) {
        setResult({ id: 'DEMO-PREVIEW', status: 'Demo only' });
        return;
      }
      if (request.partnerPostId && !values.date) {
        notify('Choose a preferred future date to book this professional.');
        return;
      }
      if (!request.partnerPostId && !request.vendorId && kind === 'service' && request.categoryId === 'manpower' &&
        (values.city?.trim().length < 2 || values.location?.trim().length < 5 || values.description?.trim().length < 5 ||
          !values.date || new Date(`${values.date}T09:00:00`).getTime() <= Date.now())) {
        notify('Add a service city, work location, short requirement and a future preferred date.');
        return;
      }
      if (request.partnerPostId && kind === 'service' && (!values.address?.trim() || !values.description?.trim())) {
        notify('Add your service address and a short work requirement.');
        return;
      }
      const response = request.partnerPostId ? await (kind === 'service' ? requestProfessionalBooking({
        partnerPostId: request.partnerPostId,
        slot: new Date(`${values.date}T09:00:00`).toISOString(),
        idempotencyKey: submissionKey.current,
        backup: values.backup && backupAvailable,
        city: values.city,
        address: values.address.trim(),
        requirement: values.description.trim()
      }) : bookPartnerOffering({
        partnerPostId: request.partnerPostId,
        slot: new Date(`${values.date}T09:00:00`).toISOString(),
        idempotencyKey: submissionKey.current
      })) : await createServiceRequest({
        idempotencyKey: submissionKey.current,
        vendorId: request.vendorId,
        categoryId: request.categoryId,
        serviceName: request.serviceName,
        requestType: kind,
        details: {
          ...values,
          ...(kind === 'service' && request.categoryId === 'manpower' && !request.vendorId && values.date ? {
            preferredSlot: new Date(`${values.date}T09:00:00`).toISOString()
          } : {}),
          vendorId: request.vendorId,
          vendorName: request.vendorName
        }
      });
      setResult(response);
    } catch (error) {
      notify(error.message || "Request could not be submitted");
    } finally {
      setBusy(false);
    }
  }
  if (result) {
    const bookingId = result.id;
    return <Sheet onClose={onClose}>
        <div className="success">
          <span className="success-check"><Icon name="check" size={42} /></span>
          <h2>{translate(request.demo ? "Demo booking preview" : "Request received")}</h2>
          <p>{translate(request.demo ? "Preview complete. No account, booking, consent, payment, review, or analytics record was created." : request.partnerPostId ? "Requested. The professional must accept before this booking is confirmed. Agree on the final charge before work begins." : "Your request has been saved securely. Pricing and availability require confirmation.")}</p>
          <div className="summary">
            <div className="summary-row"><span>{translate(kind === "service" ? "Booking ID" : "Request ID")}</span><b>{translate(bookingId)}</b></div>
            {translate(kind === "service" ? <><div className="summary-row"><span>{translate("Seller")}</span><b>{translate(request.vendorName || "To be assigned")}</b></div><div className="summary-row"><span>{translate("Service")}</span><b>{translate(request.serviceName)}</b></div><div className="summary-row"><span>{translate("Scheduled")}</span><b>{translate(values.date || "To be confirmed")}</b></div></> : null)}
            <div className="summary-row"><span>{translate("Status")}</span><b>{translate(result.status === 'requested' ? 'Requested' : result.status)}</b></div>
          </div>
          {translate(["loan", "transportation"].includes(kind) && <p>{translate("Excel synchronisation is tracked separately. The workbook connection is pending configuration.")}</p>)}
          {translate(result.quoted_total != null && <WalletCheckout booking={result} notify={notify} />)}
          <button className="btn btn-primary full" onClick={onClose}>{translate("Done")}</button>
        </div>
      </Sheet>;
  }
  return <Sheet onClose={onClose} className="form-sheet">
      <span className="eyebrow">{translate(kind)}{translate(" request")}</span>
      <h2 className="sheet-title">{translate(request.serviceName)}</h2>
      {request.demo && <div className="privacy-note"><b>{translate('Demo profile')}</b><p>{translate('This is sample data. Continuing previews the booking result and creates no account, booking, consent, payment, review, or analytics record.')}</p></div>}
      {translate(renderForm())}
    </Sheet>;
  function renderForm() {
    if (kind === "loan") return LoanForm();
    if (kind === "transportation") return TransportForm();
    if (kind === "blood") return BloodForm();
    if (kind === "influencer") return InfluencerForm();
    if (kind === "consultancy") return ConsultancyForm();
    return ServiceForm();
  }
  function ServiceForm() {
    return <form onSubmit={submit}>
        {request.fixedPrice != null && <div className="summary"><b>Published service price: {request.fixedPrice}</b><p>Review the service scope before confirming. No separate inspection is required for this fixed-price service.</p></div>}
        {request.partnerPostId ? <><p className="sheet-sub">{translate(`Request ${request.vendorName || 'this professional'}. They receive the first offer. Your full address is shared only after the booking is accepted.`)}</p><Field label="Service city" value={values.city} onChange={set("city")} required /><Field label="Service address" value={values.address} onChange={set("address")} required maxLength={500} /><Field label="What work do you need?" as="textarea" value={values.description} onChange={set("description")} required maxLength={1000} /><Field label="Preferred date" type="date" value={values.date ?? ""} onChange={set("date")} required /><label className="consent"><input type="checkbox" checked={values.backup} disabled={!backupAvailable} onChange={set("backup")} />{translate('Agar ye vendor jawab na de, similar professional dhoondhein')}</label>{!backupAvailable&&<p className="policy-note">{translate('Backup matching needs an active response-time worker. Only your selected professional receives this request right now.')}</p>}<div className="summary"><b>{translate('Price before booking')}</b>{estimateLoading ? <p>{translate('Checking published price and platform charges…')}</p> : estimate?.available ? <>{[['servicePaise','Service price'],['visitingPaise','Visiting charge'],['platformPaise','Platform charges'],['taxPaise','Applicable tax'],['totalPaise','Estimated payable']].map(([key,label]) => <p key={key}>{translate(label)}: <b>₹{(Number(estimate[key] || 0)/100).toLocaleString('en-IN',{minimumFractionDigits:2})}</b></p>)}</> : <p>{translate(estimate?.reason || 'Final payable is not available before the professional quote.')}</p>}<p>{translate('A backup offer is sent only after this professional declines or times out. A changed backup price needs your approval before confirmation. No payment is collected now.')}</p></div></> : <><p className="sheet-sub">{request.categoryId === 'manpower' && !request.vendorId ? translate('Describe the work and location. We will look for an eligible professional; the request is not confirmed until one accepts.') : <>{translate("Describe your requirement for ")}{translate(request.vendorName || "your professional")}{translate(" . Review the scope and confirmed price before work begins.")}</>}</p><Field label="Service location" value={values.location ?? ""} onChange={set("location")} required /><Field label="What help do you need?" as="textarea" value={values.description ?? ""} onChange={set("description")} required />{request.categoryId === 'manpower' && !request.vendorId && <><Field label="Service city" value={values.city} onChange={set("city")} required /><Field label="Preferred date" type="date" value={values.date ?? ""} onChange={set("date")} required /></>}<details className="quote-details">
          <summary>{translate("Product, pricing & warranty details")}</summary>
          <FormGrid>
            <Field label="Expected budget" type="number" min="0" value={values.budget ?? ""} onChange={set("budget")} />
            {(request.categoryId !== 'manpower' || request.vendorId) && <Field label="Preferred date" type="date" value={values.date ?? ""} onChange={set("date")} />}
            <Field label="Product or spare-part name" value={values.product ?? ""} onChange={set("product")} />
            <Field label="Warranty required?" as="select" options={["Not sure", "Yes", "No"]} value={values.warranty ?? "Not sure"} onChange={set("warranty")} />
          </FormGrid>
        </details></>}
        <p className="payment-warning">{translate("No payment is collected with this request. Confirm all charges before work begins.")}</p>
        {translate(/Emergency Pet/.test(request.serviceName) ? <div className="safety-card">{translate("Contact a verified veterinarian or local emergency service when an animal is in immediate danger.")}</div> : null)}
        <div className="sheet-bottom"><SubmitButton busy={busy}>{translate("Request confirmation")}</SubmitButton></div>
      </form>;
  }
  function LoanForm() {
    const steps = [<FormGrid key="personal">
        <Field label="Full name" value={values.fullName ?? ""} onChange={set("fullName")} required />
        <Field label="Mobile number" type="tel" inputMode="numeric" value={values.phone ?? ""} onChange={set("phone")} required />
        <Field label="Email address" type="email" value={values.email ?? ""} onChange={set("email")} />
        <Field label="Residential address" value={values.address ?? ""} onChange={set("address")} required />
        <Field label="City" value={values.city ?? ""} onChange={set("city")} />
        <Field label="PIN code" inputMode="numeric" maxLength="6" value={values.pin ?? ""} onChange={set("pin")} />
      </FormGrid>, <div key="occupation">
        <div className="option-toggle">
          {translate(["Salaried", "Self-Employed"].map(option => <label key={option}><input type="radio" name="occupation" required value={option} checked={values.occupation === option} onChange={set("occupation")} /> {translate(option)}</label>))}
        </div>
        {translate(values.occupation ? <FormGrid><Field label="Employer or business name" value={values.employer ?? ""} onChange={set("employer")} /><Field label="Experience or business vintage" value={values.experience ?? ""} onChange={set("experience")} /></FormGrid> : null)}
      </div>, <FormGrid key="income">
        <Field label="Monthly income" type="number" min="0" value={values.income ?? ""} onChange={set("income")} required />
        <Field label="Existing monthly EMIs" type="number" min="0" value={values.emis ?? ""} onChange={set("emis")} />
        <Field label="Primary bank" value={values.bank ?? ""} onChange={set("bank")} />
        <Field label="Credit score (optional)" type="number" min="300" max="900" value={values.creditScore ?? ""} onChange={set("creditScore")} />
      </FormGrid>, <FormGrid key="requirement">
        <Field label="Required loan amount" type="number" min="0" value={values.amount ?? ""} onChange={set("amount")} required />
        <Field label="Loan type" value={request.serviceName} readOnly />
        <Field label="Purpose of loan" value={values.purpose ?? ""} onChange={set("purpose")} />
        <Field label="Preferred tenure" value={values.tenure ?? ""} onChange={set("tenure")} />
      </FormGrid>, <div key="documents">
        <div className="document-list">
          {translate(["PAN / KYC", "Income proof", "Bank statements", "Employment or business proof", "Address proof"].map(label => <label key={label}>{translate(label)}<input type="file" /></label>))}
        </div>
        <label className="consent"><input type="checkbox" checked={values.consent} onChange={set("consent")} />{translate(" I consent to a secure credit check and data processing for this loan request.")}</label>
        <div className="privacy-note">{translate("Approval, interest rate and final terms are decided by the relevant regulated lender. Eazily is not a bank or lender.")}</div>
      </div>];
    return <form onSubmit={submit}>
        <div className="step-label">{translate("Step ")}{translate(loanStep + 1)}{translate(" of ")}{translate(steps.length)}</div>
        <div className="stepper">{translate(steps.map((_, index) => <i className={index <= loanStep ? "done" : ""} key={index} />))}</div>
        {translate(steps[loanStep])}
        <div className="sheet-bottom step-actions">
          <button className="btn btn-outline" type="button" disabled={loanStep === 0} onClick={() => setLoanStep(step => step - 1)}>{translate("Back")}</button>
          {translate(loanStep < steps.length - 1 ? <button className="btn btn-primary" type="button" onClick={event => {
          if (event.currentTarget.form.reportValidity()) setLoanStep(step => step + 1);
        }}>{translate("Continue")}</button> : <SubmitButton busy={busy}>{translate("Review & submit")}</SubmitButton>)}
        </div>
      </form>;
  }
  function TransportForm() {
    const isPassenger = /Tour|Tempo/.test(request.serviceName);
    const isCourier = /Courier/.test(request.serviceName);
    return <form onSubmit={submit}>
        <div className="transport-tabs">
          {translate(["Local", "Out-of-City"].map(mode => <button type="button" key={mode} className={values.transportMode === mode ? "active" : ""} onClick={() => setValues(current => ({
          ...current,
          transportMode: mode
        }))}>{translate(mode)}</button>))}
        </div>
        <FormGrid>
          <Field label="Full name" value={values.fullName ?? ""} onChange={set("fullName")} required />
          <Field label="Mobile number" type="tel" value={values.phone ?? ""} onChange={set("phone")} required />
          <Field label="Email address" type="email" value={values.email ?? ""} onChange={set("email")} />
          <Field label="Address" value={values.address ?? ""} onChange={set("address")} required />
          <Field label="Pickup location" value={values.pickup ?? ""} onChange={set("pickup")} required />
          <Field label="Drop location" value={values.drop ?? ""} onChange={set("drop")} required />
          <Field label="Pickup date" type="date" value={values.date ?? ""} onChange={set("date")} />
          <Field label="Shipment size" as="select" options={["1 BHK", "2 BHK", "3 BHK", "4 BHK"]} value={values.shipmentSize ?? "1 BHK"} onChange={set("shipmentSize")} required />
          {translate(isPassenger ? <><Field label="Number of passengers" type="number" min="1" value={values.passengers ?? ""} onChange={set("passengers")} /><Field label="Vehicle preference" value={values.vehicle ?? ""} onChange={set("vehicle")} /></> : null)}
          {translate(isCourier ? <><Field label="Parcel type" value={values.parcelType ?? ""} onChange={set("parcelType")} /><Field label="Approximate weight" value={values.weight ?? ""} onChange={set("weight")} /></> : null)}
        </FormGrid>
        <Field label="Special requirements" as="textarea" value={values.notes ?? ""} onChange={set("notes")} />
        <div className="sheet-bottom"><SubmitButton busy={busy}>{translate("Request a callback")}</SubmitButton></div>
      </form>;
  }
  function BloodForm() {
    if (request.serviceName === "Emergency Information") return <div className="emergency"><Icon name="drop" size={52} /><h2>{translate("Need urgent medical help?")}</h2><p>{translate("Contact the treating hospital or local emergency services immediately. Eazily cannot guarantee blood availability.")}</p><a className="btn btn-primary" href="tel:112">{translate("Call emergency services: 112")}</a></div>;
    if (request.serviceName === "Find Blood Bank") return <><Field label="Search by" as="select" options={["Current Location", "City", "PIN Code"]} value={values.searchBy ?? "Current Location"} onChange={set("searchBy")} /><Field label="Location or PIN code" value={values.location ?? ""} onChange={set("location")} /><Field label="Blood group" as="select" options={bloodGroups} value={values.bloodGroup ?? "A+"} onChange={set("bloodGroup")} /><EmptyState title="No live directory connected" text="Verified blood banks will appear when the production directory is connected." icon="drop" /></>;
    const donor = request.serviceName === "Become a Donor";
    return <form onSubmit={submit}>
        <FormGrid>
          <Field label={donor ? "Full name" : "Requester or patient name"} value={values.fullName ?? ""} onChange={set("fullName")} required />
          <Field label="Mobile number" type="tel" value={values.phone ?? ""} onChange={set("phone")} required />
          <Field label="Blood group" as="select" options={bloodGroups} value={values.bloodGroup ?? "A+"} onChange={set("bloodGroup")} />
          <Field label={donor ? "City" : "Hospital / location"} value={values.location ?? ""} onChange={set("location")} required />
          {translate(donor ? <><Field label="Age" type="number" min="18" value={values.age ?? ""} onChange={set("age")} /><Field label="Availability" value={values.availability ?? ""} onChange={set("availability")} /></> : <Field label="Units required" type="number" min="1" value={values.units ?? ""} onChange={set("units")} />)}
        </FormGrid>
        <div className="safety-card">{translate("Blood is never sold or priced here. Medical eligibility is decided only by qualified professionals.")}</div>
        <div className="sheet-bottom"><SubmitButton busy={busy}>{translate(donor ? "Review registration" : "Submit request")}</SubmitButton></div>
      </form>;
  }
  function InfluencerForm() {
    return <form onSubmit={submit}><EmptyState title="No verified profiles available yet" text="Profiles will appear when real influencer data is connected. No follower counts, engagement rates or prices are fabricated." icon="megaphone" /><SubmitButton busy={busy}>{translate("Send general enquiry")}</SubmitButton></form>;
  }
  function ConsultancyForm() {
    return <form onSubmit={submit}>
        <p className="sheet-sub">{translate("Ask a question and request a verified professional.")}</p>
        <FormGrid><Field label="Full name" value={values.fullName ?? ""} onChange={set("fullName")} required /><Field label="Mobile number" type="tel" value={values.phone ?? ""} onChange={set("phone")} required /><Field label="City" value={values.city ?? ""} onChange={set("city")} /></FormGrid>
        <Field label="Your requirement" as="textarea" value={values.requirement ?? ""} onChange={set("requirement")} required />
        <div className="credential-note">{translate("Review the professional\u2019s registration, qualification and verification status before proceeding.")}</div>
        <div className="safety-card">{translate("Eazily does not guarantee legal, medical, investment, immigration or financial outcomes.")}</div>
        <div className="sheet-bottom"><SubmitButton busy={busy}>{translate("Send enquiry")}</SubmitButton></div>
      </form>;
  }
}
