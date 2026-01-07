import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, Package, ShoppingCart, History, Plus, 
  Search, AlertTriangle, TrendingUp, DollarSign, 
  Download, Trash2, Edit3, CheckCircle2, Loader2,
  ArrowUpRight, ArrowDownLeft, Landmark, MoreVertical,
  Layers, BarChart3, Tag, ShoppingBag, X, RefreshCw,
  Users, Receipt, Wallet, CreditCard, ChevronRight, Calculator,
  MessageCircle, Share2, Printer, ChevronUp, ShoppingBasket,
  Percent, ShieldCheck, Store
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken,
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  onSnapshot,
  deleteDoc,
  getDoc,
  writeBatch
} from 'firebase/firestore';

// --- KONFIGURASI FIREBASE ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'achira-biz-pro-final';

const App = () => {
  // --- State Utama ---
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // POS State
  const [cart, setCart] = useState([]);
  const [selectedCust, setSelectedCust] = useState({ id: 'umum', name: 'Pelanggan Umum' });
  const [paymentStatus, setPaymentStatus] = useState('Lunas');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  
  // Modal Transaksi Berhasil
  const [lastSale, setLastSale] = useState(null);

  // Form Input
  const [prodForm, setProdForm] = useState({ name: '', buyPrice: '', sellPrice: '', stock: '', category: 'Umum' });
  const [expForm, setExpForm] = useState({ title: '', amount: '', category: 'Operasional' });
  const [custForm, setCustForm] = useState({ name: '', phone: '' });

  // --- Otentikasi ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error("Koneksi gagal"); }
    };
    initAuth();
    onAuthStateChanged(auth, (u) => { 
      setUser(u); 
      if(!u) setLoading(false); 
    });
  }, []);

  // --- Sinkronisasi Data Real-time ---
  useEffect(() => {
    if (!user) return;
    const paths = {
      products: collection(db, 'artifacts', appId, 'public', 'data', 'products'),
      sales: collection(db, 'artifacts', appId, 'public', 'data', 'sales'),
      expenses: collection(db, 'artifacts', appId, 'public', 'data', 'expenses'),
      customers: collection(db, 'artifacts', appId, 'public', 'data', 'customers')
    };

    const unsubProd = onSnapshot(paths.products, (snap) => setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubSales = onSnapshot(paths.sales, (snap) => setSales(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => b.date - a.date)));
    const unsubExp = onSnapshot(paths.expenses, (snap) => setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubCust = onSnapshot(paths.customers, (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => { unsubProd(); unsubSales(); unsubExp(); unsubCust(); };
  }, [user]);

  // --- Fungsi Pendukung ---
  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };
  const formatIDR = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n || 0);

  // --- Logika Keranjang POS ---
  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id);
    if (existing) {
      if (existing.qty + 1 > product.stock) return showToast('error', 'Stok tidak mencukupi!');
      setCart(cart.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item));
    } else {
      if (product.stock < 1) return showToast('error', 'Stok habis!');
      setCart([...cart, { ...product, qty: 1 }]);
    }
  };

  const removeFromCart = (id) => setCart(cart.filter(item => item.id !== id));

  const totals = useMemo(() => {
    const subtotal = cart.reduce((s, i) => s + (i.sellPrice * i.qty), 0);
    const discAmount = (Number(discount) / 100) * subtotal;
    const grandTotal = subtotal - discAmount;
    return { subtotal, discAmount, grandTotal };
  }, [cart, discount]);

  // --- Checkout Atomik ---
  const processCheckout = async () => {
    if (cart.length === 0 || processing) return;
    setProcessing(true);
    const batch = writeBatch(db);
    try {
      const { subtotal, grandTotal, discAmount } = totals;
      const totalCost = cart.reduce((sum, item) => sum + (item.buyPrice * item.qty), 0);
      const profit = grandTotal - totalCost;

      for (const item of cart) {
        const prodRef = doc(db, 'artifacts', appId, 'public', 'data', 'products', item.id);
        const prodSnap = await getDoc(prodRef);
        const currentStock = Number(prodSnap.data().stock);
        if (currentStock < item.qty) throw new Error(`${item.name} habis!`);
        batch.update(prodRef, { stock: currentStock - item.qty });
      }

      const saleData = {
        items: cart.map(i => ({ name: i.name, qty: i.qty, price: i.sellPrice })),
        customerName: selectedCust.name,
        customerPhone: customers.find(c => c.id === selectedCust.id)?.phone || '',
        subtotal,
        discount: discAmount,
        total: grandTotal,
        profit: profit,
        status: paymentStatus,
        date: Date.now()
      };

      const saleRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'sales'));
      batch.set(saleRef, saleData);
      await batch.commit();

      setLastSale(saleData);
      setCart([]); setDiscount(0); setSelectedCust({ id: 'umum', name: 'Pelanggan Umum' });
      setIsCartOpen(false);
      showToast('success', 'Transaksi Berhasil!');
    } catch (err) {
      showToast('error', err.message || 'Gagal Checkout');
    } finally {
      setProcessing(false);
    }
  };

  const sendWAStruk = (s) => {
    let msg = `*ACHIRA - STRUK PEMBAYARAN*\n`;
    msg += `--------------------------\n`;
    msg += `Tgl: ${new Date(s.date).toLocaleDateString()}\n`;
    msg += `Plg: ${s.customerName}\n\n`;
    s.items.forEach(i => msg += `• ${i.name} x${i.qty}\n   ${formatIDR(i.qty * i.price)}\n`);
    msg += `\n--------------------------\n`;
    if (s.discount > 0) msg += `Disc: -${formatIDR(s.discount)}\n`;
    msg += `*TOTAL: ${formatIDR(s.total)}*\n`;
    msg += `Status: ${s.status}\n\n`;
    msg += `_Terima kasih telah berbelanja!_`;
    
    const rawPhone = s.customerPhone || '';
    const phone = rawPhone.replace(/\D/g, '');
    const link = `https://wa.me/${phone.startsWith('0') ? '62'+phone.slice(1) : phone}?text=${encodeURIComponent(msg)}`;
    window.open(link, '_blank');
  };

  const stats = useMemo(() => {
    const revenue = sales.reduce((s, a) => s + a.total, 0);
    const profit = sales.reduce((s, a) => s + a.profit, 0);
    const exp = expenses.reduce((s, a) => s + a.amount, 0);
    return { revenue, net: profit - exp, exp, low: products.filter(p => p.stock <= 5).length };
  }, [sales, expenses, products]);

  if (loading) return <div className="h-screen flex items-center justify-center bg-rose-50"><Loader2 className="animate-spin text-rose-500 h-10 w-10"/></div>;

  return (
    <div className="min-h-screen bg-[#FFF9FB] flex flex-col md:flex-row font-sans text-slate-900 overflow-x-hidden">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 left-4 right-4 z-[400] flex items-center gap-3 px-6 py-4 rounded-3xl shadow-2xl animate-in slide-in-from-top-full ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span className="font-black text-[10px] uppercase truncate flex-1 tracking-widest">{toast.msg}</span>
          <X className="h-4 w-4" onClick={() => setToast(null)}/>
        </div>
      )}

      {/* Success Transaction Modal */}
      {lastSale && (
        <div className="fixed inset-0 z-[350] bg-rose-950/80 backdrop-blur-xl flex items-end md:items-center justify-center p-0 md:p-6">
          <div className="bg-white rounded-t-[4rem] md:rounded-[4rem] p-12 max-w-sm w-full shadow-2xl animate-in slide-in-from-bottom-full duration-500">
             <div className="flex flex-col items-center text-center">
                <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-6 shadow-inner border border-emerald-100">
                   <ShieldCheck className="h-10 w-10" />
                </div>
                <h3 className="text-2xl font-black text-slate-800 mb-1 uppercase tracking-tighter">Pembayaran Sukses</h3>
                <p className="text-rose-500 font-black text-2xl mb-10">{formatIDR(lastSale.total)}</p>
                <div className="w-full space-y-3">
                   <button onClick={() => sendWAStruk(lastSale)} className="w-full bg-emerald-500 text-white font-black py-5 rounded-3xl shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all text-xs uppercase tracking-widest">
                     <MessageCircle className="h-5 w-5" /> Kirim WhatsApp
                   </button>
                   <button onClick={() => setLastSale(null)} className="w-full bg-slate-50 text-slate-400 font-black py-5 rounded-3xl text-xs uppercase tracking-[0.2em] active:scale-95">Tutup</button>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* Desktop Sidebar Navigation */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-rose-100 p-8 sticky top-0 h-screen">
        <div className="flex items-center gap-3 mb-12 px-2">
          <div className="bg-rose-500 p-2.5 rounded-2xl shadow-xl shadow-rose-100"><Store className="text-white h-5 w-5" /></div>
          <span className="font-black text-xl uppercase text-slate-800 tracking-tighter">ACHIRA<span className="text-rose-500">BIZ</span></span>
        </div>
        <nav className="space-y-2 flex-1">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { id: 'pos', icon: ShoppingCart, label: 'Kasir Utama' },
            { id: 'inventory', icon: Package, label: 'Stok Barang' },
            { id: 'expenses', icon: Wallet, label: 'Biaya' },
            { id: 'customers', icon: Users, label: 'Pelanggan' },
            { id: 'history', icon: History, label: 'Laporan' }
          ].map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)} className={`flex items-center gap-4 w-full px-5 py-4 rounded-2xl transition-all font-bold text-[11px] uppercase tracking-widest ${activeTab === item.id ? 'bg-rose-500 text-white shadow-lg shadow-rose-100' : 'text-slate-400 hover:bg-rose-50'}`}>
              <item.icon className="h-4 w-4" /> {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* MOBILE MAIN CONTENT */}
      <main className="flex-1 flex flex-col min-h-screen relative overflow-x-hidden">
        {/* Compact Mobile Header */}
        <header className="md:hidden bg-rose-600 text-white px-6 pt-12 pb-14 rounded-b-[4rem] shadow-2xl sticky top-0 z-[100]">
           <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                 <Store className="h-6 w-6 text-rose-200" />
                 <h1 className="font-black text-xl tracking-tighter uppercase leading-none">ACHIRA MAX</h1>
              </div>
              <button onClick={() => setActiveTab('pos')} className="bg-white/20 p-3 rounded-2xl relative active:scale-90 transition-transform">
                 <ShoppingBasket className="h-6 w-6" />
                 {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-white text-rose-600 text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-rose-600 shadow-md">{cart.length}</span>}
              </button>
           </div>
           <div className="flex gap-2 overflow-x-auto no-scrollbar">
              <div className="bg-white/10 px-4 py-3 rounded-2xl border border-white/5 backdrop-blur-md min-w-[140px]">
                 <p className="text-[8px] font-black uppercase text-rose-200 mb-1">Profit Bersih</p>
                 <p className="text-sm font-black text-white">{formatIDR(stats.net)}</p>
              </div>
              <div className="bg-white/10 px-4 py-3 rounded-2xl border border-white/5 backdrop-blur-md min-w-[140px]">
                 <p className="text-[8px] font-black uppercase text-rose-200 mb-1">Hari Ini</p>
                 <p className="text-sm font-black text-white">{formatIDR(stats.revenue)}</p>
              </div>
           </div>
        </header>

        <section className="px-5 py-6 flex-1 flex flex-col gap-6 max-w-7xl mx-auto w-full mb-32">
          {/* DASHBOARD VIEW */}
          {activeTab === 'dashboard' && (
            <div className="animate-in fade-in duration-500 space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Omzet', val: stats.revenue, col: 'text-slate-900', icon: TrendingUp },
                  { label: 'Profit', val: stats.net, col: 'text-emerald-600', icon: DollarSign },
                  { label: 'Beban', val: stats.exp, col: 'text-rose-500', icon: ArrowUpRight },
                  { label: 'Stok Kritis', val: `${stats.low} Item`, col: 'text-amber-600', icon: AlertTriangle }
                ].map((s, idx) => (
                  <div key={idx} className="bg-white p-5 rounded-[2.5rem] border border-rose-50/50 shadow-sm flex flex-col justify-between h-32">
                    <div className="bg-rose-50 w-8 h-8 rounded-xl flex items-center justify-center text-rose-500"><s.icon size={14}/></div>
                    <div>
                       <p className="text-[9px] font-black text-slate-300 uppercase mb-1 tracking-widest">{s.label}</p>
                       <p className={`text-sm font-black truncate ${s.col}`}>{typeof s.val === 'number' ? formatIDR(s.val) : s.val}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="bg-white p-8 rounded-[3rem] border border-rose-50/50 shadow-sm">
                    <h3 className="text-[10px] font-black mb-6 uppercase tracking-[0.3em] text-slate-400">Transaksi Terbaru</h3>
                    <div className="space-y-4">
                       {sales.slice(0, 5).map(s => (
                         <div key={s.id} className="flex justify-between items-center p-1 border-b border-rose-50 last:border-0 pb-3">
                            <div className="min-w-0 pr-4">
                               <p className="font-bold text-slate-800 text-[11px] leading-none mb-1 truncate uppercase tracking-tight">{s.customerName}</p>
                               <p className="text-[9px] font-black text-slate-300 uppercase">{new Date(s.date).toLocaleDateString('id-ID')}</p>
                            </div>
                            <p className="font-black text-slate-900 text-xs shrink-0">{formatIDR(s.total)}</p>
                         </div>
                       ))}
                       {sales.length === 0 && <p className="text-center text-slate-200 py-10 text-[10px] font-black uppercase tracking-widest">Belum ada data</p>}
                    </div>
                 </div>
              </div>
            </div>
          )}

          {/* POS VIEW (MOBILE MAXIMIZED) */}
          {activeTab === 'pos' && (
            <div className="animate-in zoom-in-95 flex flex-col gap-4">
               {/* Fixed Mobile Search bar */}
               <div className="sticky top-[110px] md:top-0 z-40 bg-[#FFF9FB]/90 backdrop-blur-md py-2">
                  <div className="bg-white p-4 rounded-3xl border border-rose-100 flex items-center gap-3 shadow-lg">
                    <Search className="text-rose-300 h-5 w-5 shrink-0" />
                    <input placeholder="Cari barang Achira..." className="flex-1 font-bold text-xs outline-none bg-transparent" onChange={(e) => setSearchTerm(e.target.value)} />
                  </div>
               </div>

               {/* Grid of items */}
               <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pb-32">
                  {products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).map(p => (
                    <button key={p.id} onClick={() => addToCart(p)} className="bg-white p-4 rounded-[2.5rem] border border-rose-50 text-left hover:border-rose-400 active:scale-90 transition-all shadow-sm relative overflow-hidden group h-36 flex flex-col">
                      <div className="absolute top-0 left-0 w-full h-1.5 bg-rose-50/50 group-active:bg-rose-500 transition-colors"></div>
                      <h4 className="font-bold text-slate-700 text-[10px] mt-2 mb-3 h-10 overflow-hidden line-clamp-2 uppercase leading-tight tracking-tighter">{p.name}</h4>
                      <div className="mt-auto flex justify-between items-center">
                         <p className="font-black text-rose-600 text-[11px]">{formatIDR(p.sellPrice)}</p>
                         <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg ${p.stock <= 5 ? 'bg-rose-100 text-rose-600' : 'bg-slate-50 text-slate-400'}`}>{p.stock}</span>
                      </div>
                    </button>
                  ))}
               </div>

               {/* Mobile Floating Cart Button */}
               {cart.length > 0 && !isCartOpen && (
                 <button onClick={() => setIsCartOpen(true)} className="fixed bottom-32 left-1/2 -translate-x-1/2 md:hidden z-[120] bg-slate-900 text-white px-10 py-5 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.4)] flex items-center gap-4 active:scale-95 animate-in slide-in-from-bottom-10 border border-white/10">
                    <ShoppingCart className="h-5 w-5 text-rose-400" />
                    <span className="font-black text-[10px] uppercase tracking-widest">{cart.length} Item</span>
                    <div className="h-5 w-px bg-white/10"></div>
                    <span className="font-black text-sm">{formatIDR(totals.grandTotal)}</span>
                 </button>
               )}

               {/* Mobile Checkout Drawer */}
               <div className={`fixed inset-0 z-[200] bg-rose-950/70 backdrop-blur-sm md:hidden transition-opacity duration-300 ${isCartOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                  <div className={`absolute bottom-0 left-0 right-0 bg-white rounded-t-[4rem] p-10 pb-16 transition-transform duration-500 transform ${isCartOpen ? 'translate-y-0 shadow-[0_-20px_60px_rgba(0,0,0,0.2)]' : 'translate-y-full'}`}>
                    <div className="flex items-center justify-between mb-8">
                       <h3 className="font-black text-xl uppercase tracking-tighter text-slate-800">Keranjang Achira</h3>
                       <button onClick={() => setIsCartOpen(false)} className="bg-rose-50 p-3 rounded-full text-rose-400 active:bg-rose-100 transition-all"><X className="h-6 w-6"/></button>
                    </div>

                    <div className="max-h-[30vh] overflow-y-auto space-y-3 mb-8 pr-2 custom-scrollbar">
                       {cart.map(item => (
                         <div key={item.id} className="flex justify-between items-center bg-rose-50/30 p-4 rounded-[2rem] border border-rose-50/50">
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-slate-800 text-[11px] truncate uppercase">{item.name}</p>
                              <p className="text-[10px] font-black text-rose-500 uppercase">{item.qty} x {formatIDR(item.sellPrice)}</p>
                            </div>
                            <button onClick={() => removeFromCart(item.id)} className="p-3 text-rose-300 hover:text-rose-600 transition-colors"><Trash2 className="h-5 w-5"/></button>
                         </div>
                       ))}
                    </div>

                    <div className="space-y-6 pt-6 border-t border-rose-50">
                       <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2">Pelanggan</label>
                             <select 
                               className="w-full bg-slate-50 border border-slate-100 p-4 rounded-2xl font-bold text-[11px] focus:ring-2 focus:ring-rose-500 outline-none appearance-none uppercase"
                               value={selectedCust.id}
                               onChange={(e) => {
                                  const c = customers.find(x => x.id === e.target.value) || { id: 'umum', name: 'Pelanggan Umum' };
                                  setSelectedCust({ id: c.id, name: c.name });
                               }}
                             >
                                <option value="umum">UMUM</option>
                                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                             </select>
                          </div>
                          <div className="space-y-2">
                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2">Diskon (%)</label>
                             <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-full bg-slate-50 border border-slate-100 p-4 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-rose-500 outline-none text-center" />
                          </div>
                       </div>
                       
                       <div className="flex justify-between items-center px-2">
                          <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Total</span>
                          <span className="text-3xl font-black text-rose-900">{formatIDR(totals.grandTotal)}</span>
                       </div>
                       
                       <button onClick={processCheckout} disabled={processing} className="w-full bg-rose-600 text-white font-black py-6 rounded-[2.5rem] shadow-xl active:scale-95 transition-all uppercase tracking-[0.2em] text-[11px] disabled:opacity-50">
                         {processing ? 'Mencatat...' : 'Bayar & Konfirmasi'}
                       </button>
                    </div>
                  </div>
               </div>

               {/* Desktop Cart View */}
               <div className="hidden md:block lg:w-1/3">
                  <div className="bg-white rounded-[3.5rem] shadow-2xl border border-rose-50 p-10 flex flex-col h-[700px] sticky top-10">
                     <h3 className="font-black text-xl mb-10 uppercase tracking-tighter">Ringkasan Checkout</h3>
                     <div className="flex-1 overflow-y-auto space-y-4 mb-8 pr-2 custom-scrollbar">
                        {cart.map(item => (
                           <div key={item.id} className="flex justify-between items-center bg-rose-50/20 p-5 rounded-[2rem] border border-rose-50 group hover:bg-rose-50/40 transition-all">
                              <div className="min-w-0 flex-1">
                                 <p className="font-bold text-slate-800 text-xs truncate uppercase tracking-tight">{item.name}</p>
                                 <p className="text-[10px] font-black text-rose-600 uppercase">{item.qty} x {formatIDR(item.sellPrice)}</p>
                              </div>
                              <button onClick={() => removeFromCart(item.id)} className="text-rose-200 hover:text-rose-600 transition-colors"><X className="h-5 w-5"/></button>
                           </div>
                        ))}
                     </div>
                     <div className="space-y-6 border-t border-rose-50 pt-10">
                        <div className="flex justify-between items-center px-2">
                           <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Grand Total</span>
                           <span className="text-3xl font-black text-rose-900 leading-none">{formatIDR(totals.grandTotal)}</span>
                        </div>
                        <button onClick={processCheckout} disabled={cart.length === 0 || processing} className="w-full bg-rose-600 text-white font-black py-6 rounded-[2rem] shadow-xl active:scale-95 transition-all uppercase tracking-widest text-[11px]">
                           {processing ? 'Sedang Proses...' : 'Checkout Selesai'}
                        </button>
                     </div>
                  </div>
               </div>
            </div>
          )}

          {/* INVENTORY VIEW */}
          {activeTab === 'inventory' && (
            <div className="animate-in fade-in space-y-6">
               <div className="bg-white p-8 rounded-[3rem] border border-rose-50 shadow-sm">
                  <h3 className="font-black text-base mb-8 uppercase tracking-tighter text-slate-800">Tambah Barang Baru</h3>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    setProcessing(true);
                    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'products'), { ...prodForm, buyPrice: Number(prodForm.buyPrice), sellPrice: Number(prodForm.sellPrice), stock: Number(prodForm.stock), updatedAt: Date.now() });
                    setProdForm({ name: '', buyPrice: '', sellPrice: '', stock: '', category: 'Umum' });
                    setProcessing(false); showToast('success', 'Data Disimpan');
                  }} className="space-y-4">
                    <input placeholder="Nama Barang" required className="w-full bg-rose-50/40 p-4 rounded-2xl font-bold text-[11px] border-none uppercase tracking-widest focus:ring-2 focus:ring-rose-500" value={prodForm.name} onChange={(e) => setProdForm({...prodForm, name: e.target.value})} />
                    <div className="grid grid-cols-3 gap-3">
                      <input placeholder="HPP" required type="number" className="bg-rose-50/40 p-4 rounded-2xl font-bold text-[11px] border-none focus:ring-2 focus:ring-rose-500" value={prodForm.buyPrice} onChange={(e) => setProdForm({...prodForm, buyPrice: e.target.value})} />
                      <input placeholder="Jual" required type="number" className="bg-rose-50/40 p-4 rounded-2xl font-bold text-[11px] border-none focus:ring-2 focus:ring-rose-500" value={prodForm.sellPrice} onChange={(e) => setProdForm({...prodForm, sellPrice: e.target.value})} />
                      <input placeholder="Stok" required type="number" className="bg-rose-50/40 p-4 rounded-2xl font-bold text-[11px] border-none focus:ring-2 focus:ring-rose-500" value={prodForm.stock} onChange={(e) => setProdForm({...prodForm, stock: e.target.value})} />
                    </div>
                    <button className="w-full bg-rose-600 text-white font-black py-5 rounded-[2rem] shadow-lg active:scale-95 transition-all text-[11px] uppercase tracking-widest">Daftarkan Produk</button>
                  </form>
               </div>
               
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {products.map(p => (
                    <div key={p.id} className="bg-white p-6 rounded-[2.5rem] border border-rose-50 shadow-sm relative group active:bg-rose-50/30 transition-all">
                       <h4 className="font-black text-slate-800 text-[11px] mb-5 truncate pr-10 uppercase tracking-tighter">{p.name}</h4>
                       <div className="flex justify-between items-end">
                          <div>
                            <p className="text-[9px] font-black text-slate-300 uppercase mb-1">Harga Jual</p>
                            <p className="font-black text-rose-600 text-base leading-none">{formatIDR(p.sellPrice)}</p>
                          </div>
                          <span className={`text-[10px] font-black px-4 py-2 rounded-2xl ${p.stock <= 5 ? 'bg-rose-100 text-rose-600 border border-rose-200' : 'bg-slate-50 text-slate-400 border border-slate-100 shadow-inner'}`}>{p.stock} Unit</span>
                       </div>
                       <button onClick={async () => await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', p.id))} className="absolute top-6 right-6 text-rose-100 hover:text-rose-500 active:scale-90 transition-all"><Trash2 className="h-5 w-5"/></button>
                    </div>
                  ))}
               </div>
            </div>
          )}

          {/* CUSTOMERS VIEW - ENSURING VISIBILITY */}
          {activeTab === 'customers' && (
            <div className="animate-in fade-in space-y-8 max-w-xl mx-auto">
               <div className="bg-white p-8 rounded-[3.5rem] border border-rose-50 shadow-sm">
                  <h3 className="text-xs font-black mb-8 uppercase text-slate-800 tracking-[0.2em]">Registrasi Pelanggan</h3>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    setProcessing(true);
                    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'customers'), { ...custForm, createdAt: Date.now() });
                    setCustForm({ name: '', phone: '' });
                    setProcessing(false); showToast('success', 'Member Baru Terdaftar');
                  }} className="space-y-4">
                     <input placeholder="Nama Member" required className="w-full bg-rose-50/30 p-5 rounded-2xl text-[11px] font-bold border-none uppercase tracking-widest focus:ring-2 focus:ring-rose-500" value={custForm.name} onChange={(e) => setCustForm({...custForm, name: e.target.value})} />
                     <input placeholder="WhatsApp (Aktif)" required className="w-full bg-rose-50/30 p-5 rounded-2xl text-[11px] font-bold border-none tracking-widest focus:ring-2 focus:ring-rose-500" value={custForm.phone} onChange={(e) => setCustForm({...custForm, phone: e.target.value})} />
                     <button className="w-full bg-rose-600 text-white font-black py-5 rounded-[2.5rem] shadow-lg text-[11px] uppercase tracking-widest active:scale-95 transition-all">Tambah Member</button>
                  </form>
               </div>
               
               <div className="space-y-3 pb-10">
                  <p className="text-[10px] font-black uppercase text-slate-300 ml-4 tracking-[0.4em]">Database Member ({customers.length})</p>
                  {customers.map(c => (
                    <div key={c.id} className="bg-white p-6 rounded-[2.5rem] border border-rose-50 flex justify-between items-center px-8 shadow-sm group active:bg-rose-50/50">
                       <div className="flex items-center gap-5">
                         <div className="h-12 w-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center font-black text-sm uppercase shadow-inner border border-rose-100">{c.name.charAt(0)}</div>
                         <div className="min-w-0">
                           <p className="font-bold text-slate-800 text-xs leading-none mb-2 uppercase truncate max-w-[180px]">{c.name}</p>
                           <p className="text-[10px] font-black text-slate-300 tracking-wider">{c.phone}</p>
                         </div>
                       </div>
                       <button onClick={async () => await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'customers', c.id))} className="text-rose-100 hover:text-rose-600 active:scale-90 transition-all"><Trash2 className="h-5 w-5"/></button>
                    </div>
                  ))}
                  {customers.length === 0 && <div className="text-center py-20 text-rose-100 uppercase text-[10px] font-black italic tracking-widest">Belum ada pelanggan terdaftar</div>}
               </div>
            </div>
          )}

          {/* HISTORY VIEW */}
          {activeTab === 'history' && (
            <div className="animate-in fade-in">
               <div className="bg-white rounded-[3.5rem] shadow-sm border border-rose-50 overflow-hidden min-h-[60vh]">
                  <div className="p-10 bg-rose-50/10 border-b border-rose-50 flex justify-between items-center">
                     <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter leading-none">Log Penjualan</h2>
                     <button className="bg-white p-3.5 rounded-2xl border border-rose-100 text-rose-500 shadow-sm active:scale-90 transition-transform"><History size={20}/></button>
                  </div>
                  <div className="overflow-x-auto">
                     <table className="w-full text-left table-auto min-w-[550px]">
                        <thead>
                           <tr className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em] border-b border-rose-50 bg-slate-50/50">
                              <th className="px-10 py-8">Tanggal / Nama</th>
                              <th className="px-10 py-8 text-right">Pembayaran</th>
                              <th className="px-10 py-8 text-center">WA Struk</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-rose-50">
                           {sales.map(s => (
                              <tr key={s.id} className="active:bg-rose-50/40 transition-colors">
                                 <td className="px-10 py-8">
                                    <p className="font-black text-slate-800 text-[11px] uppercase truncate leading-tight mb-2 max-w-[150px]">{s.customerName}</p>
                                    <p className="text-[9px] text-slate-300 font-black uppercase tracking-wider">{new Date(s.date).toLocaleDateString('id-ID', {day:'numeric', month:'long'})}</p>
                                 </td>
                                 <td className="px-10 py-8 text-right font-black text-rose-900 text-xs whitespace-nowrap">{formatIDR(s.total)}</td>
                                 <td className="px-10 py-8 text-center">
                                    <button onClick={() => sendWAStruk(s)} className="p-4 bg-rose-50 text-rose-500 rounded-[1.5rem] active:scale-90 border border-rose-100 shadow-sm"><MessageCircle size={18}/></button>
                                 </td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                     {sales.length === 0 && <div className="p-40 text-center text-rose-100 font-black italic text-[11px] uppercase tracking-[0.5em]">Kosong</div>}
                  </div>
               </div>
            </div>
          )}
        </section>

        {/* BOTTOM NAV - NEW DOCK STYLE WITH Z-PROTECTION */}
        <nav className="md:hidden fixed bottom-6 left-5 right-5 h-20 bg-slate-900/98 backdrop-blur-xl rounded-[2.5rem] flex justify-around items-center px-4 z-[200] shadow-[0_25px_60px_rgba(0,0,0,0.6)] border border-white/10">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Home' },
            { id: 'pos', icon: ShoppingBasket, label: 'Kasir' },
            { id: 'inventory', icon: Package, label: 'Stok' },
            { id: 'customers', icon: Users, label: 'Member' },
            { id: 'history', icon: History, label: 'Log' }
          ].map(item => (
            <button 
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-all duration-300 relative ${
                activeTab === item.id ? 'text-rose-400 -translate-y-2' : 'text-slate-500'
              }`}
            >
              <div className={`p-3.5 rounded-[1.5rem] transition-all ${activeTab === item.id ? 'bg-rose-400/10 shadow-[inset_0_0_20px_rgba(251,113,133,0.1)]' : ''}`}>
                <item.icon className={`h-6 w-6 ${activeTab === item.id ? 'stroke-[2.5px]' : 'stroke-[1.8px]'}`} />
              </div>
              <span className={`text-[8px] font-black uppercase tracking-[0.2em] mt-1.5 transition-opacity duration-300 ${activeTab === item.id ? 'opacity-100' : 'opacity-0 h-0'}`}>
                {item.label}
              </span>
              {activeTab === item.id && <div className="absolute -bottom-1 w-6 h-1 bg-rose-400 rounded-full blur-[2px]"></div>}
            </button>
          ))}
        </nav>
      </main>
    </div>
  );
};

export default App;