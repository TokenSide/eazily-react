import { translate } from "../lib/translate.js";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { BottomNav, EmptyState, SearchBox } from "../components/Ui.jsx";
import { catalog, createSearchIndex } from "../data/catalog.js";
import { displayInfluencerCategory } from "../data/influencerCategories.js";
import { displayConsultantCategory } from "../data/consultantCategories.js";
import RequestSheet from "../features/requests/RequestSheet.jsx";
import UserHome from "../features/home/UserHome.jsx";
import ServiceExperience from "../features/services/ServiceExperience.jsx";
import RoleMarketplace from '../features/services/RoleMarketplace.jsx';
import CustomerAccount from "../features/account/CustomerAccount.jsx";
import { canonicalService } from "../services/experience.js";
import { requestSignIn } from '../lib/account.js';
import ServiceIllustration from '../features/user-art/ServiceIllustration.jsx';
import '../features/user-art/compact-services.css';
import '../features/user-motion/user-motion.css';
import { usePublicRealtimeAudience, useRealtime } from '../lib/realtime.jsx';
import ChatWorkspace from '../features/chat/ChatWorkspace.jsx';
import { startChat } from '../services/chat.js';
import { ConsumerConsentHost } from '../features/legal/ConsumerLegal.jsx';
import { IN_APP_BACK_EVENT, pushNavigationState, replaceNavigationState } from '../lib/nativeShell.js';
import { getCustomerProfessionalById } from '../services/marketplace.js';
import BulkOrders from '../features/bulk-orders/BulkOrders.jsx';
import CustomerVideos from '../features/videos/CustomerVideos.jsx';
import { PARTNER_DEMO_ENABLED } from '../features/partners/demo/config.js';
import { isSupabaseConfigured } from '../lib/supabase.js';
export default function UserApp({
  notify, account, onWorkspace, onAddRole
}) {
  const isolatedDemo = PARTNER_DEMO_ENABLED && !isSupabaseConfigured && !account?.user;
  const { revision: realtimeRevision } = useRealtime();
  const [route, setRoute] = useState(() => history.state?.eazilyUserRoute || "home");
  const [selectedMain, setSelectedMain] = useState(() => history.state?.eazilySelectedMain || null);
  const [selectedGroup, setSelectedGroup] = useState(() => history.state?.eazilySelectedGroup || null);
  const categorySidebar = useRef(null);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [request, setRequest] = useState(null);
  const [profileSheet, setProfileSheet] = useState(null);
  const [bulkOrdersOrigin, setBulkOrdersOrigin] = useState(null);
  const [chatTarget, setChatTarget] = useState(null);
  const [service, setService] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('service') ? {
      serviceName: params.get('service'),
      categoryId: params.get('category') || 'manpower'
    } : null;
  });
  const [vendor, updateVendor] = useState(null);
  useEffect(() => {
    const sidebar = categorySidebar.current;
    const active = sidebar?.querySelector('.group-nav.active');
    if (active && sidebar.scrollHeight > sidebar.clientHeight) {
      const item = active.getBoundingClientRect(), viewport = sidebar.getBoundingClientRect();
      sidebar.scrollTop += item.top - viewport.top - (sidebar.clientHeight - item.height) / 2;
    }
  }, [selectedGroup, selectedMain, route, service]);
  const previousScroll = useRef(0);
  const [location, setLocation] = useState(() => localStorage.getItem('eazily-city') || 'Bhopal');
  usePublicRealtimeAudience(location);
  useEffect(() => {
    localStorage.setItem('eazily-city', location);
  }, [location]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('vendor');
    if (id && service) getCustomerProfessionalById(id, service.serviceName, location).then(profile => updateVendor(profile)).catch(e => notify(e.message));
  }, [notify, realtimeRevision, service, location]);
  useEffect(() => {
    replaceNavigationState({
      eazilyDepth: Number(history.state?.eazilyDepth || 0),
      eazilyUserRoute: history.state?.eazilyUserRoute || 'home',
      eazilySelectedMain: history.state?.eazilySelectedMain || null,
      eazilySelectedGroup: history.state?.eazilySelectedGroup || null
    });
  }, []);
  useEffect(() => {
    const back = event => {
      const params = new URLSearchParams(window.location.search);
      if (!params.has('service') && service) {
        setService(null);
        updateVendor(null);
        requestAnimationFrame(() => window.scrollTo(0, previousScroll.current));
      }
      if (!params.has('service')) {
        setRoute(event.state?.eazilyUserRoute || 'home');
        setSelectedMain(event.state?.eazilySelectedMain || null);
        setSelectedGroup(event.state?.eazilySelectedGroup || null);
      }
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [service]);
  useEffect(() => {
    const back = event => {
      if (Number(history.state?.eazilyDepth || 0) > 0) {
        event.detail.handled = true;
        history.back();
      } else if (service || route !== 'home') {
        event.detail.handled = true;
        const url = new URL(window.location.href);
        for (const key of ['service', 'category', 'vendor']) url.searchParams.delete(key);
        replaceNavigationState({ eazilyUserRoute: 'home', eazilySelectedMain: null, eazilySelectedGroup: null }, url);
        setService(null);
        updateVendor(null);
        setRoute('home');
      }
    };
    window.addEventListener(IN_APP_BACK_EVENT, back);
    return () => window.removeEventListener(IN_APP_BACK_EVENT, back);
  }, [route, service]);
  function setVendor(next) {
    updateVendor(next);
  }
  function openService(next, specificVendor = null) {
    if (!account?.user && !isolatedDemo) { requestSignIn(); return; }
    const selection = {
      ...next,
      serviceName: canonicalService(next.serviceName)
    };
    if (['loans', 'transportation', 'blood-bank'].includes(selection.categoryId)) {
      setRequest(selection);
      return;
    }
    if (!service) previousScroll.current = window.scrollY;
    const url = new URL(window.location.href);
    url.searchParams.set('service', selection.serviceName);
    url.searchParams.set('category', selection.categoryId);
    url.searchParams.delete('vendor');
    if (service) history.replaceState(history.state, '', url);else pushNavigationState({
      servicePage: true,
      eazilyUserRoute: route,
      eazilySelectedMain: selectedMain,
      eazilySelectedGroup: selectedGroup
    }, url);
    setService(selection);
    updateVendor(specificVendor);
    setSearch('');
  }
  function leaveService() {
    if (history.state?.servicePage && !history.state?.sheet) history.back();else {
      const url = new URL(window.location.href);
      for (const key of ['service', 'category', 'vendor']) url.searchParams.delete(key);
      replaceNavigationState({servicePage:false}, url);
      setService(null);
      updateVendor(null);
      setRoute('categories');
    }
  }
  function openVendor(v) {
    openService({
      categoryId: v.partner_role === 'influencer' ? 'influencers' : v.partner_role === 'consultant' ? 'consultancy' : v.category_id || 'manpower',
      serviceName: v.partner_role === 'influencer'
        ? displayInfluencerCategory(v.service_names?.[0] || v.profession)
        : v.partner_role === 'consultant'
          ? displayConsultantCategory(v.service_names?.[0] || v.profession)
        : v.service_names?.[0] || canonicalService(v.profession),
      directProvider: true
    }, v);
  }
  function closeVendor() {
    if (!service?.directProvider) { updateVendor(null); return; }
    history.go(history.state?.sheet ? -2 : -1);
  }
  const searchIndex = useMemo(createSearchIndex, []);
  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return searchIndex.filter(item => [item.name, item.path, ...(item.aliases ?? [])].join(" ").toLowerCase().includes(query)).slice(0, 10);
  }, [search, searchIndex]);
  function navigate(next) {
    if (next === 'messages' && !account?.user) { requestSignIn(); return; }
    if (next !== route || service) pushNavigationState({
      eazilyUserRoute: next,
      eazilySelectedMain: next === 'categories' ? selectedMain : null,
      eazilySelectedGroup: next === 'categories' ? selectedGroup : null,
      servicePage: false,
      sheet: undefined
    });
    setService(null);
    updateVendor(null);
    setRoute(next);
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }
  function startBooking(next) {
    if (!account?.user && !next.demo) { requestSignIn(); return; }
    setRequest(next);
  }
  async function messageProvider(postId) {
    if (!account?.user) { requestSignIn(); return; }
    if (!postId) return notify('This provider does not have a published messaging profile.');
    try {
      const conversation = await startChat({ postId });
      setChatTarget(conversation.id);
      navigate('messages');
    } catch (error) { notify(error.message); }
  }
  function selectMain(id) {
    pushNavigationState({eazilyUserRoute:'categories',eazilySelectedMain:id,eazilySelectedGroup:null,servicePage:false});
    setSelectedMain(id);
    setSelectedGroup(null);
    setRoute("categories");
  }
  function selectGroup(id) {
    pushNavigationState({eazilyUserRoute:'categories',eazilySelectedMain:selectedMain,eazilySelectedGroup:id,servicePage:false});
    setSelectedGroup(id);
  }
  function selectSearchResult(item) {
    setSearch("");
    setSelectedMain(item.mainId);
    setSelectedGroup(item.groupId ?? null);
    setRoute("categories");
    pushNavigationState({eazilyUserRoute:'categories',eazilySelectedMain:item.mainId,eazilySelectedGroup:item.groupId??null,servicePage:false});
    const main = catalog.find(entry => entry.id === item.mainId);
    const isMain = main?.label === item.name;
    const isGroup = main?.groups?.some(group => group.label === item.name);
    if (!isMain && !isGroup) openService({
      categoryId: item.mainId,
      serviceName: item.name
    });
  }
  function SearchArea() {
    return <div className="search-area">
        <SearchBox value={search} onChange={setSearch} />
        {translate(search ? <div className="search-results">{translate(results.length ? results.map(item => <button key={item.path} onClick={() => selectSearchResult(item)}><b>{translate(item.name)}</b><small>{translate(item.path)}</small></button>) : <EmptyState title="No matches found" text="Try another spelling or a simpler word." icon="search" />)}</div> : null)}
      </div>;
  }
  function Home() {
    return <UserHome route={route} navigate={navigate} selectMain={selectMain} setRequest={openService} setProfileSheet={name => { setProfileSheet(name); navigate("profile"); }} onBulkOrders={() => setBulkOrdersOrigin('home')} onVendor={openVendor} onMessage={messageProvider} city={location} onCityChange={setLocation} notify={notify} searchArea={SearchArea()} demoMode={isolatedDemo} />;
  }
  function Categories() {
    const main = catalog.find(category => category.id === selectedMain) ?? null;
    const group = main?.groups?.find(entry => entry.id === selectedGroup) ?? null;
    const items = group?.items ?? main?.items ?? [];
    return <main className={'screen catalog-screen user-art-catalog' + (main && (!main.groups || group) ? ' user-compact-services' : main?.groups ? ' user-group-selection' : '')}>
        <header className="catalog-header">{translate(SearchArea())}</header>
        <div className="catalog-layout">
          {translate(main?.groups && group ? <aside className="catalog-side" ref={categorySidebar} aria-label={translate('Service groups')}><button className="all-back" onClick={() => {
            setSelectedMain(null);
            setSelectedGroup(null);
          }}><Icon name="arrowLeft" /><span>{translate("Back")}</span></button>{translate(main.groups.map(entry => <button className={`group-nav ${selectedGroup === entry.id ? "active" : ""}`} aria-current={selectedGroup === entry.id ? 'true' : undefined} key={entry.id} onClick={() => selectGroup(entry.id)}><ServiceIllustration name={entry.label} /><span>{translate(entry.label)}</span></button>))}</aside> : null)}
          <section className="catalog-content">
            {translate(!main ? <><section className="catalog-welcome"><h1>{translate("Choose a category")}</h1></section><div className="main-category-grid">{translate(catalog.map(category => <button className="main-category-card" onClick={() => selectMain(category.id)} key={category.id}><i className="main-category-image"><ServiceIllustration name={category.label} /></i><span className="main-category-content"><span className="main-category-name">{translate(category.label)}</span><small>{translate("View options")}</small></span></button>))}</div></> : null)}
            {translate(main?.groups && !group ? <><Breadcrumb main={main} /><section className="catalog-welcome compact"><h1>{translate("Choose a service group")}</h1></section><div className="group-card-grid">{translate(main.groups.map(entry => <button className="group-card" key={entry.id} onClick={() => selectGroup(entry.id)}><i><ServiceIllustration name={entry.label} /></i><span><b>{translate(entry.label)}</b><small>{translate(entry.items.length)}{translate(" options")}</small></span><Icon name="chevronRight" /></button>))}</div></> : null)}
            {translate(main && (!main.groups || group) ? <><Breadcrumb main={main} group={group} /><section className="catalog-welcome compact"><h1>{translate(group?.label ?? main.label)}</h1>{translate(main.filter ? <div className={`filter-chips${main.id === "influencers" ? " influencer-tier-selector" : ""}`} aria-label={main.id === "influencers" ? "Influencer follower range" : undefined}>{translate(main.filter.map(entry => <button className={filter === entry ? "active" : ""} key={entry} onClick={() => setFilter(entry)}>{translate(entry)}</button>))}</div> : null)}</section><div className="service-option-grid" key={group?.id || main.id}>{translate(items.map(name => <button className="service-option" key={name} onClick={() => openService({
                categoryId: main.id,
                serviceName: name
              })}><i><ServiceIllustration name={name} /></i><span>{translate(name)}</span></button>))}</div></> : null)}
          </section>
        </div>
        <BottomNav route={route} onChange={navigate} />
      </main>;
  }
  function Breadcrumb({
    main,
    group
  }) {
    return <div className="crumb"><button onClick={() => {
        setSelectedMain(null);
        setSelectedGroup(null);
      }}><Icon name="arrowLeft" size={14} />{translate("All Categories")}</button><Icon name="chevronRight" size={15} />{group ? <button onClick={() => setSelectedGroup(null)}>{translate(main.label)}</button> : <b>{translate(main.label)}</b>}{translate(group ? <><Icon name="chevronRight" size={15} /><b>{translate(group.label)}</b></> : null)}</div>;
  }
  function Messages() {
    return <main className="screen"><header className="topbar"><h1 className="greeting">{translate("Messages")}</h1></header><ChatWorkspace initialConversationId={chatTarget} onConversationHandled={() => setChatTarget(null)} notify={notify} /><BottomNav route={route} onChange={navigate} /></main>;
  }
  const pages = {
    home: Home(),
    categories: Categories(),
    messages: Messages(),
    videos: <CustomerVideos route={route} onNavigate={navigate} notify={notify} />,
    profile: <CustomerAccount initialPanel={profileSheet} onInitialHandled={setProfileSheet} notify={notify} onVendor={openVendor} onNavigate={navigate} account={account} onWorkspace={onWorkspace} onAddRole={onAddRole} />
  };
  const servicePage = service && (['influencers', 'consultancy'].includes(service.categoryId)
    ? <RoleMarketplace key={service.serviceName} service={service} initialProvider={vendor} onBack={leaveService} onMessage={messageProvider} notify={notify} />
    : <ServiceExperience key={service.serviceName} service={service} vendor={vendor} setVendor={setVendor} onService={openService} onBook={startBooking} onMessage={messageProvider} onBack={leaveService} onCloseVendor={closeVendor} location={location} setLocation={setLocation} notify={notify} demoMode={isolatedDemo} />);
  const pageKey = bulkOrdersOrigin ? `bulk-orders:${bulkOrdersOrigin}` : service ? `service:${service.categoryId}:${service.serviceName}` : `route:${route}`;
  const activePage = bulkOrdersOrigin ? <BulkOrders profile={account?.profile} accountId={account?.user?.id} onBack={() => setBulkOrdersOrigin(null)} /> : servicePage || pages[route] || pages.home;
  return <div className="user-app-root" key={pageKey}><ConsumerConsentHost />{translate(activePage)}{translate(request ? <RequestSheet request={request} onClose={() => setRequest(null)} notify={notify} /> : null)}</div>;
}
