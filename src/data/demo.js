export const photos = {
  electrician: "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=700&q=80",
  cleaning: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=700&q=80",
  ac: "https://images.unsplash.com/photo-1631545806609-83d16cb2ae62?auto=format&fit=crop&w=700&q=80",
  painter: "https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=700&q=80",
  professional: "https://images.unsplash.com/photo-1622098542704-e6e6c70f2056?auto=format&fit=crop&w=400&q=80",
  ajay: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80",
  support: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80",
};

export const services = [
  { id: "electrician", name: "Electrician", price: 199, rating: 4.8, image: photos.electrician },
  { id: "cleaning", name: "Home Cleaning", price: 299, rating: 4.9, image: photos.cleaning },
  { id: "ac", name: "AC Repair", price: 399, rating: 4.7, image: photos.ac },
  { id: "painter", name: "Painter", price: 499, rating: 4.8, image: photos.painter },
];

export const conversations = [
  { id: 1, name: "Rajesh Sharma", message: "I’ll reach your location by 10:30 AM", time: "10:02 AM", unread: 2, image: photos.professional },
  { id: 2, name: "Eazily Support", message: "Your refund has been processed.", time: "Yesterday", unread: 0, image: photos.support },
  { id: 3, name: "Sharma Home Cleaning", message: "Thank you for choosing Eazily!", time: "Monday", unread: 0, image: photos.ajay },
];

export const adminNavigation = [
  ["dashboard", "dashboard", "Dashboard"], ["users", "person", "Users"],
  ["vendors", "workers", "Vendors"], ["services", "grid", "Services & Categories"],
  ["orders", "clipboard", "Orders"], ["finance", "rupee", "Payments & Revenue"],
  ["approvals", "check", "Approvals"], ["content", "video", "Content"],
  ["trust", "shield", "Trust & Safety"], ["analytics", "chart", "Analytics"],
  ["support", "message", "Support"], ["staff", "briefcase", "Staff & Permissions"],
  ["audit", "history", "Audit Logs"], ["settings", "settings", "Settings"],
];

export const adminTables = {
  users: {
    title: "User Management",
    subtitle: "Customer visibility and account controls",
    columns: ["User", "Location", "Orders", "Spending", "Last Active", "Status"],
    rows: [
      ["#U-10482 · Rahul Sharma", "Bhopal", "18", "₹14,280", "2 min ago", "Active"],
      ["#U-10471 · Priya Gupta", "Indore", "7", "₹5,430", "1 hr ago", "Active"],
      ["#U-10458 · Amit Singh", "Delhi", "0", "₹0", "12 days ago", "Inactive"],
    ],
  },
  vendors: {
    title: "Vendor Management",
    subtitle: "Performance, verification and business health",
    columns: ["Vendor", "Category", "Location", "Orders", "Revenue", "Rating", "Status"],
    rows: [
      ["#V-1024 · ABC Plumbing", "Home Services", "Bhopal", "245", "₹4.8L", "4.9", "Active"],
      ["#V-1018 · Swift Repairs", "Appliance Repair", "Delhi", "210", "₹4.1L", "4.8", "Active"],
      ["#V-1011 · Glow Studio", "Beauty", "Indore", "—", "—", "—", "Pending"],
    ],
  },
  orders: {
    title: "Orders Control Center",
    subtitle: "Monitor booking, payment and service timelines",
    columns: ["Order", "Customer", "Vendor", "Service", "Value", "Payment", "Status"],
    rows: [
      ["#EZ-1256", "Rahul Sharma", "ABC Plumbing", "Pipe Repair", "₹799", "Pending", "Requested"],
      ["#EZ-1255", "Priya Gupta", "Swift Repairs", "AC Repair", "₹1,299", "Paid", "In Progress"],
      ["#EZ-1254", "Amit Singh", "Glow Studio", "Salon", "₹899", "Paid", "Completed"],
    ],
  },
  finance: {
    title: "Payments & Revenue",
    subtitle: "Service commissions, subscriptions, payouts and refunds",
    columns: ["Transaction", "Vendor", "Revenue type", "Gross", "Eazily revenue", "Seller payout", "Status"],
    rows: [
      ["#SUB-39021", "ABC Plumbing", "PRO subscription", "₹499", "₹499", "—", "Active"],
      ["#TX-88201", "ABC Plumbing", "Service commission", "₹2,500", "₹375", "₹2,125", "Processed"],
      ["#SUB-39018", "Swift Repairs", "PRE subscription", "₹299", "₹299", "—", "Active"],
      ["#TX-88177", "Clean Pro", "Service commission", "₹3,499", "₹525", "₹2,974", "Failed"],
    ],
  },
  approvals: {
    title: "Approval Center",
    subtitle: "Review vendors, documents and marketplace content",
    columns: ["Application", "Applicant", "Type", "Submitted", "Risk", "Status"],
    rows: [
      ["#VA-2045", "Glow Studio", "Vendor verification", "Today", "Low", "Pending"],
      ["#PA-8891", "Ajay Plumbing", "Service post", "Today", "Low", "Pending"],
      ["#VA-2038", "Quick Finance", "Financial vendor", "Yesterday", "Medium", "Under Review"],
    ],
  },
};
