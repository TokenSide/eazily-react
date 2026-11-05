import { serviceQuote, collaborationQuote } from './pricing.js';

export const roles = ['professional', 'influencer', 'consultant'];
export const profiles = {
  professional: { businessName: 'Demo • Lakeview Electricals', name: 'Aarav Sample', city: 'Bhopal', category: 'Home & Property', services: ['Electrician'], address: 'Sample shop, Arera Colony, Bhopal', description: 'Fictional electrical repair shop. Registered and verified only inside this demo.' },
  influencer: { creatorName: 'Demo • Bhopal Food Stories', name: 'Tara Sample', city: 'Bhopal', category: 'Food & Lifestyle', relatedNiches: ['Local cafés'], platforms: [], description: 'Fictional food creator offering paid café reels. No linked social accounts.' },
  consultant: { name: 'Demo • Nisha Career Studio', city: 'Bhopal', category: 'Career Guidance', specialisation: 'Career Guidance', qualificationName: 'Sample career coach', experience: '5 years (fictional)', description: 'Fictional career professional. Sample CV and interview guidance sessions.' },
};
const customers = ['Mira Sample', 'Kabir Example', 'Anaya Sample', 'Rohan Example', 'Diya Sample', 'Ishan Example', 'Leela Sample'];
const locations = ['Arera Colony', 'Kolar Road', 'MP Nagar', 'Shahpura', 'Gulmohar', 'Bairagarh', 'Lalghati'];
const titles = {
  professional: ['Ceiling fan repair', 'Kitchen socket repair', 'Light fixture installation', 'Switchboard inspection', 'Doorbell repair', 'Study light installation', 'Fan regulator replacement'],
  influencer: ['Café launch reel', 'Bakery menu showcase', 'Coffee tasting reel', 'Local lunch feature', 'Dessert launch story', 'Brunch collaboration', 'Seasonal café reel'],
  consultant: ['CV review session', 'Interview preparation', 'Career options discussion', 'Portfolio feedback', 'Five-minute career introduction', 'Career planning session', 'Job-search guidance'],
};

export function sampleOrder(role, index, now) {
  const i = index % 7;
  const appointment = new Date(now + (index + 1) * 86400000);
  appointment.setUTCHours(4, 30, 0, 0); // 10:00 AM in Bhopal, always a future sample date.
  return {
    id: `demo-${role}-${index}`, role, title: titles[role][i], customer_name: customers[i],
    location: `${locations[i]}, Bhopal (fictional)`, status: 'requested',
    deadline: appointment.toISOString(),
    amount: role === 'professional' ? 400 + i * 100 : role === 'influencer' ? 2000 + i * 500 : 600 + i * 100,
    details: { service: role === 'professional' ? 'Electrician' : profiles[role].category, description: role === 'professional' ? 'Inspect and repair the listed electrical fitting. Parts and final scope are confirmed at the visit.' : role === 'influencer' ? 'One paid café feature with agreed scope. No barter, external links, or real brand contacts.' : 'A fictional career guidance enquiry; no personal documents are included.', deliverables: role === 'influencer' ? '1 short reel and 2 story frames' : undefined },
    events: [{ kind: 'Sample request received', at: new Date(now).toISOString() }], messages: [], payment: null, quote: null,
  };
}

export function createDemoState(now = Date.now()) {
  return { notice: '', error: '', workspaces: Object.fromEntries(roles.map(role => {
    const orders = Array.from({ length: 7 }, (_, i) => sampleOrder(role, i, now));
    ['requested', 'requested', 'accepted', 'active', 'awaiting_acceptance', 'completed', 'cancelled'].forEach((status, i) => { orders[i].status = status; });
    // In-progress and past work should not look like future appointments.
    [1, 4, 24, 48].forEach((hoursAgo, i) => { orders[i + 3].deadline = new Date(now - hoursAgo * 3600000).toISOString(); });
    orders.forEach(order => { order.events = [{ kind: `Seeded sample: ${order.status}`, at: new Date(now).toISOString() }]; });
    const earnings = [];
    if (role === 'professional') {
      orders[3].arrivalVerified = true;
      orders[4].arrivalVerified = true;
      orders[4].quote = { ...serviceQuote(orders[4].amount * 100), status: 'proposed' };
      orders[5].quote = { ...serviceQuote(orders[5].amount * 100), status: 'paid' };
      orders[5].payment = 'paid';
      earnings.push({ id: `${orders[5].id}-pending`, order_id: orders[5].id, state: 'pending', amount: orders[5].amount });
    }
    if (role === 'influencer') {
      orders[4].prepaid = true;
      orders[4].collaboration = collaborationQuote(orders[4].amount);
      orders[5].prepaid = true;
      orders[5].payment = 'paid';
      orders[5].scopeConfirmed = true;
      orders[5].holdReleased = true;
      orders[5].collaboration = collaborationQuote(orders[5].amount);
      earnings.push({ id: `${orders[5].id}-pending`, order_id: orders[5].id, state: 'pending', amount: orders[5].collaboration.initialRelease }, { id: `${orders[5].id}-hold`, order_id: orders[5].id, state: 'available', amount: orders[5].collaboration.securityHold });
    }
    if (role === 'consultant') {
      orders[4].amount = 0;
      orders[4].freeIntro = true;
      orders[5].amount = 0;
      orders[5].freeIntro = true;
      orders[5].title = 'Completed five-minute introduction';
    }
    return [role, { online: true, nextIndex: 7, orders, earnings, reviews: [],
      posts: [0, 1].map(i => ({ id: `demo-post-${role}-${i}`, status: 'published', details: { title: titles[role][i], caption: titles[role][i], postType: 'offering' } })),
      notifications: [{ id: `demo-welcome-${role}`, title: 'Your fictional workspace is ready', read_at: null }],
    }];
  })) };
}
