-- Influencer-only legal documents and server-recorded consent for version 2026-09-12.
-- Apply after schema.sql, partners.sql, and operations.sql. Do not edit published
-- document content after acceptance; publish a new version instead.
begin;

alter table public.legal_documents
  add column if not exists document_key text,
  add column if not exists last_updated_at timestamptz;

alter table public.legal_documents drop constraint if exists legal_documents_kind_language_version_key;

create unique index if not exists legal_document_key_version
  on public.legal_documents(document_key,language,version)
  where document_key is not null;

create unique index if not exists generic_legal_document_kind_version
  on public.legal_documents(kind,language,version)
  where document_key is null;

insert into public.legal_documents(kind,language,version,title,content,published,effective_at,document_key,last_updated_at)
values
('terms','English','2026-09-12','Eazily – Influencer Service Provider Terms & Conditions',
$influencer_terms$
EAZILY – INFLUENCER SERVICE PROVIDER TERMS & CONDITIONS

Effective Date: 12 September 2026
Last Updated: 12 September 2026

These Influencer Service Provider Terms & Conditions (“Terms”) govern the registration and provision of influencer, creator, promotional, and related services by an Influencer (“Influencer”, “Service Provider”, “you”, or “your”) through the Eazily platform (“Eazily”, “Platform”, “we”, “us”, or “our”).

By registering, creating a service listing, accepting a booking, or providing services through Eazily, you confirm that you have read, understood, and agreed to these Terms.

1. DEFINITIONS AND SCOPE

Influencer means an individual, content creator, social-media professional, public personality, reviewer, brand ambassador, or other eligible professional providing services through Eazily.

Influencer Services may include social-media promotion, Instagram or YouTube content, reels, photography, videography, product reviews, unboxing, business promotion, event appearances, brand campaigns, live sessions, brand ambassador services, and other creator-related services offered through the Platform.

Customer means the person, business, organisation, or entity booking an Influencer Service.

Booking means a service request confirmed through Eazily.

Deliverables means the content, promotion, appearance, posts, videos, photographs, reviews, campaigns, or other services agreed under a Booking.

These Terms apply specifically to the Influencer as a Service Provider and govern the Influencer's responsibilities, service delivery, content, payments, conduct, and use of the Platform.

2. REGISTRATION AND ELIGIBILITY

2.1 You must provide complete, accurate, and current information when registering as an Influencer.

2.2 You may be required to provide reasonable information or verification relating to your identity, professional profile, social-media accounts, portfolio, experience, service capabilities, and service area.

2.3 You must have the necessary rights, permissions, and legal authority to provide the services you list.

2.4 You must not create an account using another person's identity or provide misleading information about your professional background.

2.5 You are responsible for keeping your account information updated and maintaining the security of your login credentials.

3. INFLUENCER PROFILE AND SERVICE LISTING

3.1 Your profile must accurately represent your professional identity, experience, portfolio, social-media presence, service category, location, availability, and capabilities.

3.2 Each service listing must clearly state, where applicable:

Service description
Deliverables
Number of posts, videos, photographs, or appearances
Social-media platform
Service duration
Expected completion time
Pricing
Number of revisions
Location requirements
Content or usage rights
Additional charges

3.3 You must not intentionally misrepresent followers, subscribers, views, engagement, reach, previous campaigns, experience, or other performance information.

3.4 You must not list a service that you cannot reasonably provide.

4. BOOKING ACCEPTANCE AND SERVICE DELIVERY

4.1 You should review the Customer's requirements, Deliverables, price, timeline, location, and other applicable conditions before accepting a Booking.

4.2 Once a Booking is accepted, you must provide the agreed service professionally and within the agreed timeframe.

4.3 You must communicate promptly regarding requirements, scheduling, content approvals, changes, delays, or circumstances affecting the service.

4.4 If you are unable to complete a Booking, you must notify the Customer and Eazily as soon as reasonably possible.

4.5 You must not materially change the agreed service or Deliverables without appropriate communication and agreement.

4.6 You are responsible for providing the equipment, skills, resources, and professional arrangements reasonably necessary to complete your listed service unless the Booking states otherwise.

5. CONTENT AND DELIVERABLES

5.1 You must provide the Deliverables specifically agreed in the Booking, which may include posts, reels, stories, photographs, videos, reviews, product demonstrations, live sessions, event appearances, promotional campaigns, or other agreed work.

5.2 Content must comply with the agreed requirements concerning format, duration, quantity, platform, concept, script, caption, hashtags, mentions, style, location, and deadline.

5.3 You must make reasonable efforts to ensure that Deliverables are professionally prepared and suitable for the agreed purpose.

5.4 You must not knowingly provide fraudulent, copied, misleading, or unlawfully created content.

5.5 You must comply with applicable social-media platform rules and applicable advertising and consumer-protection requirements.

6. REVISIONS AND ADDITIONAL WORK

6.1 You must provide only the number of revisions included in the Booking.

6.2 Reasonable corrections within the original agreed scope should be handled as part of the included revisions.

6.3 New concepts, additional filming, major changes, additional Deliverables, extra platforms, additional shooting, or extended content usage may be treated as additional services.

6.4 You must clearly communicate and obtain agreement for additional charges before providing chargeable additional work.

7. INTELLECTUAL PROPERTY AND CONTENT RIGHTS

7.1 Unless otherwise agreed, you retain ownership of your original creative work to the extent permitted by applicable law.

7.2 Payment for a service does not automatically transfer all intellectual-property rights to the Customer.

7.3 The Customer's permitted use of Deliverables shall be determined by the Booking or a separate written agreement.

7.4 Any transfer or grant of rights involving exclusive ownership, paid advertising, perpetual use, modification, commercial redistribution, resale, or other extended rights should be expressly agreed before or during the Booking.

7.5 You must not use third-party copyrighted material, trademarks, music, images, videos, or other protected content without the necessary rights or permission.

8. CUSTOMER MATERIALS AND CONFIDENTIALITY

8.1 Customers may provide products, logos, photographs, videos, scripts, trademarks, promotional materials, or other information for completion of a Booking.

8.2 You must use such materials only for legitimate purposes connected with the agreed service.

8.3 You must not knowingly publish, sell, distribute, misuse, or disclose confidential Customer information outside the agreed purpose.

8.4 You must take reasonable care when handling Customer products, property, personal information, business information, and private communications.

9. ADVERTISING, DISCLOSURE AND LEGAL COMPLIANCE

9.1 You must comply with applicable laws, advertising requirements, consumer-protection requirements, intellectual-property laws, and social-media platform policies.

9.2 Where a service involves paid, sponsored, promotional, or commercial content, you must make legally or platform-required disclosures in an appropriate and transparent manner.

9.3 You must not knowingly make false, deceptive, unsupported, or unlawful claims about a Customer, product, business, or service.

9.4 Fake reviews, fabricated testimonials, impersonation, deceptive engagement, misleading promotions, and fraudulent campaigns are prohibited.

9.5 You are responsible for obtaining any professional permission, licence, consent, or approval legally required for the services you provide.

10. PROHIBITED CONDUCT

You must not use Eazily to provide, promote, or facilitate services involving:

Fraud or scams
Fake reviews or testimonials
Impersonation
Misleading advertising
Copyright or trademark infringement
Unauthorised use of another person's identity or content
Harassment, threats, intimidation, or discrimination
Illegal activities
Deceptive business practices
False product or service claims
Artificial or fraudulent engagement
Content or services prohibited by applicable law or Eazily policy

Eazily may remove content, restrict services, suspend an account, or terminate access where reasonably necessary because of prohibited conduct.

11. CUSTOMER COMMUNICATION AND PROFESSIONAL CONDUCT

11.1 You must communicate respectfully and professionally with Customers.

11.2 You must not harass, threaten, abuse, intimidate, discriminate against, or repeatedly contact a Customer without a legitimate service-related reason.

11.3 You must respect Customer privacy and must not misuse personal contact information or private communications.

11.4 Where Eazily provides in-platform communication, you should use it for Booking-related communication where reasonably practicable.

11.5 You must not pressure Customers to bypass Eazily's applicable booking, payment, commission, or Platform procedures.

12. PAYMENT AND COMMERCIAL TERMS

12.1 Payment for completed services will be processed according to Eazily's applicable payment and settlement procedures.

12.2 Amounts payable to you may be affected by applicable Platform fees, commissions, taxes, payment-processing charges, refunds, adjustments, or other disclosed deductions.

12.3 Applicable pricing and commercial conditions should be communicated through the Platform or relevant agreement.

12.4 You must not impose unauthorised charges on Customers.

12.5 Any additional paid service must be agreed before the additional work is provided.

13. CANCELLATION, DELAY AND NON-COMPLETION

13.1 You should not cancel a confirmed Booking without a genuine and reasonable reason.

13.2 If cancellation or delay becomes necessary, you must inform the Customer and Eazily as soon as reasonably possible.

13.3 Depending on the circumstances, Eazily may facilitate rescheduling, an alternative Service Provider, cancellation, refund, credit, or other appropriate resolution.

13.4 Repeated unreasonable cancellations, delays, or failure to complete accepted Bookings may result in restrictions or suspension of your account.

13.5 Circumstances reasonably beyond your control, such as natural disasters, government restrictions, major technical failures, or other extraordinary events may be considered when determining responsibility for delay or non-performance.

14. REVIEWS, RATINGS AND PERFORMANCE INFORMATION

14.1 Customers may rate and review your services through Eazily.

14.2 You must not create, purchase, manipulate, or arrange fraudulent reviews or ratings.

14.3 You must not threaten, pressure, or improperly influence a Customer regarding a review.

14.4 You may respond professionally to reviews where the Platform permits.

14.5 Eazily may take appropriate action regarding reviews or ratings that violate applicable policies or law.

15. OFF-PLATFORM TRANSACTIONS

15.1 You must not intentionally use Eazily to obtain Customers and then circumvent applicable Eazily fees, commissions, or Platform procedures.

15.2 You must not pressure or induce Customers to move Eazily Bookings off-platform for the purpose of avoiding applicable Platform charges or controls.

15.3 Repeated or intentional transaction circumvention may result in account restrictions, suspension, or termination.

16. EAZILY'S ROLE

16.1 Eazily operates as a technology and marketplace platform that facilitates connections between Customers and independent Service Providers.

16.2 Unless separately agreed, you are an independent Service Provider and not an employee, partner, joint-venture participant, or agent of Eazily.

16.3 Eazily may facilitate service discovery, Booking, communication, payment processing, customer support, reviews, and dispute assistance.

16.4 Eazily does not guarantee a particular number of Bookings, income, followers, engagement, views, sales, campaign performance, viral results, or business outcomes.

16.5 You remain responsible for the quality, legality, accuracy, and completion of the services you provide.

17. ACCOUNT SUSPENSION OR TERMINATION

Eazily may restrict, suspend, remove, or terminate your account or service listings where reasonably necessary due to:

Fraud or false information
Repeated cancellations or non-performance
Prohibited content or activities
Customer safety concerns
Harassment or misconduct
Intellectual-property violations
Payment abuse
Transaction circumvention
Account misuse
Violation of these Terms
Violation of applicable law

Where appropriate, Eazily may provide notice or an opportunity to address the issue.

18. DISPUTES AND SUPPORT

18.1 You should first attempt to resolve service-related issues professionally with the Customer.

18.2 Eazily may assist in reviewing disputes using relevant information such as Booking details, service listings, communications, payment records, Deliverables, complaints, reviews, and other available evidence.

18.3 Eazily's involvement in a dispute does not guarantee a particular outcome.

18.4 You agree to cooperate reasonably with Eazily during service-related investigations or complaints.

19. PRIVACY AND DATA PROTECTION

19.1 You must handle personal and confidential information obtained through Eazily responsibly and in accordance with applicable law and Eazily's applicable privacy requirements.

19.2 You must not unnecessarily collect, store, publish, or disclose private Customer information.

19.3 Information obtained through Eazily must be used only for legitimate service-related purposes or as otherwise legally permitted.

20. CHANGES, GOVERNING LAW AND SEVERABILITY

20.1 Eazily may update these Terms from time to time. Updated Terms may be made available through the Platform or other appropriate communication channels.

20.2 Continued use of Eazily after applicable changes take effect may constitute acceptance of the updated Terms, subject to applicable law.

20.3 These Terms shall be governed by the laws applicable in India.

20.4 Subject to applicable law, disputes shall be subject to the jurisdiction of the courts located at [UNRESOLVED: Court city and state, India].

20.5 If any provision is found invalid or unenforceable, the remaining provisions shall continue to apply to the extent permitted by law.

21. CONTACT DETAILS AND ACCEPTANCE

Company: [UNRESOLVED: Full legal company name]
Platform: Eazily
Registered Address: [UNRESOLVED: Full registered address]
Email: [UNRESOLVED: Official email address]
Support: [UNRESOLVED: Support number]
Website: [UNRESOLVED: Website]
Grievance Contact: [UNRESOLVED: Grievance contact name/designation]
Grievance Email: [UNRESOLVED: Grievance email]

By registering as an Influencer, creating a service listing, accepting a Booking, or providing Influencer Services through Eazily, you acknowledge that you have read, understood, and accepted these Terms & Conditions.

Influencer Name: __________________________

Signature / Digital Acceptance: __________________________

Date: __________________________
$influencer_terms$,false,'2026-09-12 00:00:00+05:30','eazily-influencer-provider-terms','2026-09-12 00:00:00+05:30'),
('privacy_policy','English','2026-09-12','Eazily – Influencer Privacy Policy',
$influencer_privacy$
EAZILY – INFLUENCER PRIVACY POLICY

Effective Date: 12 September 2026
Last Updated: 12 September 2026

This Influencer Privacy Policy (“Policy”) explains how [UNRESOLVED: Full legal company name], operating the Eazily platform (“Eazily”, “Platform”, “we”, “us”, or “our”), collects, uses, stores, shares, and protects personal information of Influencers who register and provide services through Eazily.

This Policy applies specifically to Influencers and Service Providers offering influencer, creator, promotional, content creation, social-media, event appearance, or related services through the Platform.

By registering or using Eazily as an Influencer, you acknowledge that you have read and understood this Policy, subject to applicable law.

1. INFORMATION WE COLLECT

Eazily may collect information reasonably required to create, verify, operate, and support your Influencer account.

1.1 Personal and Account Information

This may include:

Full name or professional name
Mobile number and email address
City and service area
Profile photograph
Account and login information
Age or eligibility information where legally required
1.2 Professional Information

Depending on your services, we may collect:

Professional biography
Skills and experience
Service categories
Portfolio and previous work
Pricing and availability
Social-media profiles
Public follower, audience, reach, or engagement information
Business or professional information
1.3 Verification Information

Where reasonably necessary, Eazily may request information to verify your identity, professional profile, service capabilities, prevent fraud, or comply with applicable legal requirements.

1.4 Booking and Service Information

We may collect information relating to your use of the Platform, including:

Booking details
Customer requirements
Service schedules
Deliverables
Service-related communications
Cancellations
Ratings and reviews
Complaints and disputes
Service history
1.5 Payment Information

For payments and settlements, we may process relevant information such as bank details, transaction information, tax-related information, payment identifiers, and settlement records.

Payment information may also be processed by authorised payment service providers.

2. SOCIAL MEDIA AND PUBLIC INFORMATION

If you provide links to your social-media accounts or professional profiles, Eazily may use relevant publicly available information to:

Create and display your professional profile
Help Customers evaluate your services
Verify information provided by you
Prevent fraud or misleading representations
Improve marketplace trust

Eazily does not require access to private social-media accounts unless separately authorised and legally permitted.

3. HOW WE USE YOUR INFORMATION

Eazily may use Influencer information to:

Create and manage your account.
Verify your profile and eligibility.
Display your professional services to Customers.
Facilitate Bookings and service delivery.
Communicate with you regarding services and Platform activities.
Process payments and settlements.
Provide support and resolve complaints or disputes.
Maintain ratings, reviews, and service records.
Detect and prevent fraud, misuse, and prohibited activities.
Protect Platform security and integrity.
Improve Eazily's features, services, and user experience.
Comply with applicable laws, regulations, and legal obligations.
Enforce Eazily's Terms & Conditions and other applicable policies.
4. INFORMATION DISPLAYED TO CUSTOMERS

As Eazily operates as a service marketplace, certain professional information may be visible to Customers.

This may include:

Professional name
Profile photograph
Biography
Service category
Portfolio
Public social-media links
Service area
Experience
Pricing
Ratings and reviews
Other information included in your professional profile

Eazily will generally avoid displaying unnecessary private information such as passwords, private communications, or payment credentials.

5. COMMUNICATION AND BOOKING INFORMATION

Eazily may process information exchanged in connection with Bookings where necessary to provide services, support Customers and Influencers, investigate complaints, prevent fraud, resolve disputes, or maintain appropriate business records.

This may include communications relating to service requirements, scheduling, Deliverables, changes, cancellations, complaints, and disputes.

Where permitted by law, relevant information may be retained for these legitimate purposes.

6. PAYMENT AND FINANCIAL INFORMATION

Payments and settlements may be processed through Eazily or authorised payment providers.

Relevant transaction information may be used to:

Process payments and settlements
Calculate applicable Platform fees or commissions
Process refunds or adjustments
Maintain financial records
Meet tax and legal obligations
Detect suspicious or fraudulent transactions

Third-party payment providers may process information according to their own privacy policies.

7. SHARING OF INFORMATION

Eazily may share necessary information with appropriate parties for legitimate Platform purposes.

Customers

Relevant professional and Booking information may be shared with Customers to help them evaluate, book, and communicate with you.

Service Providers

Information may be shared with trusted providers supporting payment processing, hosting, communication, security, verification, analytics, customer support, and technical operations.

Legal Authorities

Information may be disclosed where required or permitted by applicable law, court order, legal process, or lawful governmental request.

Business Transfers

Where legally permitted, information may be transferred in connection with a merger, acquisition, restructuring, financing, sale of assets, or similar business transaction, subject to appropriate safeguards.

Eazily does not intend to sell Influencer personal information as a standalone commercial product.

8. DATA SECURITY

Eazily takes reasonable technical and organisational measures to protect Influencer information from unauthorised access, misuse, alteration, disclosure, loss, or destruction.

Security measures may include access controls, authentication, secure transmission, restricted access, monitoring, secure storage, and incident-response procedures.

However, no electronic system or internet transmission can be guaranteed to be completely secure.

You should also take reasonable precautions to protect your account credentials and notify Eazily if you suspect unauthorised access.

9. DATA RETENTION

Eazily may retain Influencer information for as long as reasonably necessary for:

Account and Platform operation
Service and payment processing
Customer support
Dispute resolution
Fraud prevention
Legal, tax, accounting, or regulatory requirements
Enforcement of agreements and policies

When information is no longer required, Eazily may delete, anonymise, or securely dispose of it in accordance with applicable law and its retention procedures.

10. YOUR PRIVACY RIGHTS

Subject to applicable law, you may have rights to:

Request access to certain personal information
Request correction of inaccurate information
Request deletion where legally applicable
Withdraw consent where processing is based on consent
Request information regarding applicable processing
Raise privacy-related complaints or grievances

Some requests may be subject to legal, contractual, security, or operational limitations.

Where processing is based on consent, withdrawal of consent may affect Eazily's ability to provide certain services that require the relevant information. Withdrawal will not affect processing that Eazily is legally required or otherwise permitted to continue.

11. COOKIES AND SIMILAR TECHNOLOGIES

Eazily may use cookies, device identifiers, analytics tools, and similar technologies to:

Maintain secure sessions
Remember preferences
Improve Platform functionality
Analyse Platform usage
Monitor performance
Detect suspicious activity

Where required by applicable law, Eazily will provide appropriate notice or obtain consent.

Additional information may be provided in the Eazily Cookie Policy.

12. THIRD-PARTY SERVICES

Eazily may use third-party services for payment processing, hosting, analytics, communication, verification, security, and other technical functions.

Such providers may process information under their own terms and privacy policies.

Eazily expects service providers handling information on its behalf to maintain appropriate confidentiality and security measures.

13. INFLUENCER RESPONSIBILITIES

As an Influencer, you must:

Provide accurate personal and professional information.
Keep your profile reasonably updated.
Protect your account credentials.
Respect Customer privacy.
Use Customer information only for legitimate service purposes.
Avoid collecting unnecessary Customer information.
Follow applicable privacy and data-protection requirements.
Promptly report suspected unauthorised access or misuse.

You must not disclose or use Customer personal information for unrelated purposes without an appropriate legal basis or permission.

14. MINORS AND ELIGIBILITY

Influencer services are intended for individuals who are legally eligible to register and provide such services under applicable law.

Eazily does not knowingly seek to collect personal information from individuals who are not eligible to use Influencer services.

Where age verification or additional consent is legally required, appropriate procedures may be applied.

15. DATA TRANSFERS AND SECURITY INCIDENTS

Depending on Eazily's technology infrastructure and service providers, Influencer information may be processed or stored outside your state or country, subject to applicable law.

Where required, Eazily will implement appropriate safeguards for such processing or transfer.

If Eazily becomes aware of a personal-data security incident requiring notification under applicable law, it will take appropriate steps to investigate, contain, mitigate, and notify affected persons or authorities where legally required.

16. POLICY UPDATES

Eazily may update this Policy to reflect changes in:

Applicable laws
Platform features
Business operations
Technology
Data-processing practices

The updated Policy may be published through the Eazily Platform or website. The “Last Updated” date will indicate the latest revision.

17. PRIVACY CONTACT AND GRIEVANCE

For privacy requests, questions, or complaints, contact:

Company: [UNRESOLVED: Full legal company name]
Platform: Eazily
Registered Address: [UNRESOLVED: Full registered address]
Privacy Email: [UNRESOLVED: Privacy email address]
Grievance Officer: [UNRESOLVED: Grievance contact name/designation]
Grievance Email: [UNRESOLVED: Grievance email]
Support Number: [UNRESOLVED: Support number]
Website: [UNRESOLVED: Website]

Privacy requests and grievances will be handled in accordance with applicable law and Eazily's applicable procedures.

18. GOVERNING LAW

This Policy shall be governed by the laws applicable in India.

Any dispute relating to this Policy shall be subject to the jurisdiction specified in Eazily's applicable legal Terms & Conditions, subject to applicable law.

19. ACCEPTANCE

By registering as an Influencer, creating a professional profile, listing services, accepting Bookings, or using Eazily as a Service Provider, you acknowledge that you have read and understood this Influencer Privacy Policy.

Influencer Name: __________________________

Digital Acceptance / Signature: __________________________

Date: __________________________
$influencer_privacy$,false,'2026-09-12 00:00:00+05:30','eazily-influencer-provider-privacy-policy','2026-09-12 00:00:00+05:30')
on conflict do nothing;

create or replace function public.save_partner_application(p_role text,p_details jsonb,p_submit boolean default false) returns partner_applications language plpgsql security definer set search_path=public as $$
declare result partner_applications; next_status text;
begin
 if auth.uid() is null then raise exception 'Sign in to apply'; end if;
 if p_role not in('professional','influencer','consultant') then raise exception 'Invalid role'; end if;
 if p_submit and (coalesce(length(trim(p_details->>'name')),0)<2 or coalesce(p_details->>'city','')='' or coalesce(p_details->>'pinCode','')='' or coalesce(p_details->>'language','')='') then raise exception 'Complete the required shared details'; end if;
 if p_submit and p_role='influencer' and (
   coalesce((p_details#>>'{consent,termsAccepted}')::boolean,false)=false
   or coalesce((p_details#>>'{consent,informationAccurate}')::boolean,false)=false
   or coalesce(p_details#>>'{consent,documentId}','')<>'eazily-influencer-provider-terms'
   or coalesce(p_details#>>'{consent,version}','')<>'2026-09-12'
 ) then raise exception 'Explicit acceptance of Influencer Terms version 2026-09-12 and information confirmation are required'; end if;
 if p_submit and p_role='influencer' and not exists(
   select 1 from legal_documents where document_key='eazily-influencer-provider-terms' and language='English' and version='2026-09-12' and published
 ) then raise exception 'Required Influencer Terms document is not published'; end if;
 if p_submit and p_role<>'influencer' and (coalesce((p_details#>>'{consent,termsAccepted}')::boolean,false)=false or coalesce((p_details#>>'{consent,informationAccurate}')::boolean,false)=false or coalesce(p_details#>>'{consent,version}','')='' or coalesce(p_details#>>'{consent,acceptedAt}','')='') then raise exception 'Terms and information-accuracy consent are required'; end if;
 if p_submit and p_role='professional' and (jsonb_array_length(coalesce(p_details->'services','[]'))=0 or coalesce(p_details->>'shopOwnership','')='' or coalesce(p_details->>'experience','')='' or coalesce(p_details->>'workStyle','')='' or coalesce(p_details->>'accountHolder','')='' or coalesce(p_details->>'accountNumber','')='' or p_details->>'accountNumber'<>p_details->>'accountConfirmation' or coalesce(p_details->>'ifsc','')='' or jsonb_array_length(coalesce(p_details->'aadhaar','[]'))=0 or jsonb_array_length(coalesce(p_details->'pan','[]'))=0 or (p_details->>'shopOwnership'<>'No fixed shop' and jsonb_array_length(coalesce(p_details->'gumasta','[]'))=0 and coalesce((p_details->>'gumastaHelp')::boolean,false)=false)) then raise exception 'Complete required service-partner registration items'; end if;
 if p_submit and p_role='influencer' and (coalesce(p_details->>'creatorName','')='' or coalesce(p_details->>'email','')='' or jsonb_array_length(coalesce(p_details->'platforms','[]'))=0 or jsonb_array_length(coalesce(p_details->'insightScreenshots','[]'))=0 or jsonb_array_length(coalesce(p_details->'aadhaar','[]'))=0 or p_details->>'accountNumber'<>p_details->>'accountConfirmation') then raise exception 'Complete required creator registration items'; end if;
 if p_submit and p_role='consultant' and (coalesce(p_details->>'specialisation','')='' or coalesce(p_details->>'qualificationName','')='' or jsonb_array_length(coalesce(p_details->'qualifications','[]'))=0 or jsonb_array_length(coalesce(p_details->'aadhaar','[]'))=0 or jsonb_array_length(coalesce(p_details->'pan','[]'))=0 or p_details->>'accountNumber'<>p_details->>'accountConfirmation') then raise exception 'Complete required consultant registration items'; end if;
 next_status:=case when p_submit then 'submitted' else 'draft' end;
 insert into partner_applications(customer_id,role,status,details,submitted_at) values(auth.uid(),p_role,next_status,p_details,case when p_submit then now() end)
 on conflict(customer_id,role) do update set details=excluded.details,status=case when partner_applications.status in('approved','under_review') then partner_applications.status else excluded.status end,
 submitted_at=case when excluded.status='submitted' then now() else partner_applications.submitted_at end,updated_at=now()
 returning * into result;
 if p_submit and p_role='influencer' then
  insert into consent_events(account_id,partner_application_id,consent_type,version,accepted,consent_text,recorded_at)
  values(auth.uid(),result.id,'eazily-influencer-provider-terms','2026-09-12',true,'I have read and agree to the Eazily Influencer Terms & Conditions.',now())
  on conflict(partner_application_id,consent_type,version) where partner_application_id is not null do nothing;
 elsif p_submit then
  insert into consent_events(account_id,partner_application_id,consent_type,version,accepted,consent_text,recorded_at)
  values(auth.uid(),result.id,'partner_registration',p_details#>>'{consent,version}',true,'Role terms accepted and supplied information confirmed accurate',(p_details#>>'{consent,acceptedAt}')::timestamptz)
  on conflict(partner_application_id,consent_type,version) where partner_application_id is not null do nothing;
 end if;
 return result;
end $$;

create or replace function public.accept_influencer_terms(p_application_id uuid,p_document_id text,p_version text) returns consent_events language plpgsql security definer set search_path=public as $$
declare app partner_applications; result consent_events;
begin
 if auth.uid() is null then raise exception 'Sign in to accept Influencer Terms'; end if;
 if p_document_id<>'eazily-influencer-provider-terms' or p_version<>'2026-09-12' then raise exception 'The required Influencer Terms document and version must be accepted'; end if;
 select * into app from partner_applications where id=p_application_id and customer_id=auth.uid() and role='influencer';
 if app.id is null then raise exception 'Your Influencer application was not found'; end if;
 if not exists(select 1 from legal_documents where document_key=p_document_id and language='English' and version=p_version and published) then raise exception 'Required Influencer Terms document is not published'; end if;
 insert into consent_events(account_id,partner_application_id,consent_type,version,accepted,consent_text,recorded_at)
 values(auth.uid(),app.id,p_document_id,p_version,true,'I have read and agree to the Eazily Influencer Terms & Conditions.',now())
 on conflict(partner_application_id,consent_type,version) where partner_application_id is not null do nothing
 returning * into result;
 if result.id is null then
  select * into result from consent_events where partner_application_id=app.id and consent_type=p_document_id and version=p_version and accepted order by recorded_at desc limit 1;
 else
  insert into partner_audit_log(actor_id,action,entity_type,entity_id,after_data)
  values(auth.uid(),'accept_influencer_terms','partner_application',app.id::text,jsonb_build_object('documentId',p_document_id,'version',p_version,'consentEventId',result.id));
 end if;
 return result;
end $$;

revoke all on function public.save_partner_application(text,jsonb,boolean) from public,anon;
grant execute on function public.save_partner_application(text,jsonb,boolean) to authenticated;
revoke all on function public.accept_influencer_terms(uuid,text,text) from public,anon;
grant execute on function public.accept_influencer_terms(uuid,text,text) to authenticated;

commit;
