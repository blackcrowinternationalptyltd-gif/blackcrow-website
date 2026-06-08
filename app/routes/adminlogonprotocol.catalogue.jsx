import {json, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler} from '@remix-run/node';
import {useLoaderData, useFetcher, useRevalidator} from '@remix-run/react';
import {useState, useRef, useEffect} from 'react';
import {getSupabase} from '~/lib/supabase.server';
import {requireAdminUser} from '~/lib/auth.server';

export const meta = () => [{title: 'Catalogue Control | BlackCrow Admin'}];

/* ─── Loader ─────────────────────────────────────────────────────────────── */

export async function loader({request, context}) {
  await requireAdminUser(request);
  const sb = getSupabase();
  if (!sb) return json({products: [], dbAvailable: false});
  const {data, error} = await sb
    .from('products')
    .select('*')
    .order('display_order', {ascending: true});
  if (error) return json({products: [], dbAvailable: false});
  return json({products: data ?? [], dbAvailable: true});
}

/* ─── Action ─────────────────────────────────────────────────────────────── */

export async function action({request, context}) {
  await requireAdminUser(request);
  const contentType = request.headers.get('content-type') ?? '';

  /* ── Image upload (multipart) ── */
  if (contentType.includes('multipart/form-data')) {
    const handler = unstable_createMemoryUploadHandler({maxPartSize: 8_000_000});
    const formData = await unstable_parseMultipartFormData(request, handler);
    const file = formData.get('file');
    const slug = formData.get('slug') ?? 'misc';

    const sb = getSupabase();
    if (!sb || !file || typeof file === 'string') return json({error: 'Upload failed'});

    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${slug}/${Date.now()}.${ext}`;
    const buf = await file.arrayBuffer();
    const {error} = await sb.storage
      .from('product-images')
      .upload(path, buf, {contentType: file.type ?? 'image/jpeg', upsert: true});
    if (error) return json({error: error.message});
    const {data: urlData} = sb.storage.from('product-images').getPublicUrl(path);
    return json({url: urlData.publicUrl});
  }

  /* ── JSON / form mutations ── */
  const form = await request.formData();
  const _action = form.get('_action');
  const sb = getSupabase();
  if (!sb) return json({error: 'Database unavailable'});

  /* helpers */
  const txt = (k) => (form.get(k) ?? '').toString().trim() || null;
  const num = (k, fallback = 0) => {
    const v = parseFloat(form.get(k) ?? '');
    return isNaN(v) ? fallback : v;
  };
  const int = (k, fallback = 0) => {
    const v = parseInt(form.get(k) ?? '');
    return isNaN(v) ? fallback : v;
  };
  const countries = form.getAll('available_countries').map(String);

  const galleryRaw = txt('gallery_image_urls') ?? '';
  const galleryUrls = galleryRaw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const productFields = {
    name: (txt('name') ?? '').toUpperCase(),
    slug: txt('slug') ?? '',
    category: txt('category') ?? 'Drying',
    short_tagline: txt('short_tagline'),
    description: txt('description'),
    price: num('price'),
    compare_at_price: form.get('compare_at_price') ? num('compare_at_price') : null,
    status: txt('status') ?? 'draft',
    main_image_url: txt('main_image_url'),
    gallery_image_urls: galleryUrls,
    sku: txt('sku'),
    tax_code: txt('tax_code') ?? 'GST',
    display_order: int('display_order'),
    available_countries: countries.length ? countries : ['Australia', 'USA', 'UK', 'Canada', 'Sweden'],
  };

  if (_action === 'create') {
    const {error} = await sb.from('products').insert(productFields);
    return json({ok: !error, error: error?.message});
  }

  if (_action === 'edit') {
    const {error} = await sb
      .from('products')
      .update({...productFields, updated_at: new Date().toISOString()})
      .eq('id', form.get('id'));
    return json({ok: !error, error: error?.message});
  }

  if (_action === 'set_status') {
    const {error} = await sb
      .from('products')
      .update({status: form.get('status'), updated_at: new Date().toISOString()})
      .eq('id', form.get('id'));
    return json({ok: !error, error: error?.message});
  }

  if (_action === 'delete') {
    const {error} = await sb.from('products').delete().eq('id', form.get('id'));
    return json({ok: !error, error: error?.message});
  }

  return json({error: 'Unknown action'});
}

/* ─── Constants ──────────────────────────────────────────────────────────── */

const CATEGORIES = ['Drying', 'Interior', 'Exterior'];
const STATUSES = ['active', 'coming_soon', 'draft', 'archived'];
const COUNTRIES = ['Australia', 'USA', 'UK', 'Canada', 'Sweden'];

const STATUS_LABELS = {
  active: 'Active',
  coming_soon: 'Coming Soon',
  draft: 'Draft',
  archived: 'Archived',
};
const STATUS_COLORS = {
  active:      {bg: 'bg-[#22c55e]/15', text: 'text-[#22c55e]'},
  coming_soon: {bg: 'bg-[#f59e0b]/15', text: 'text-[#f59e0b]'},
  draft:       {bg: 'bg-white/10',     text: 'text-bc-secondary'},
  archived:    {bg: 'bg-bc-red/10',    text: 'text-bc-red'},
};
const CAT_COLORS = {
  Drying:   {bg: 'bg-bc-red/10',      text: 'text-bc-red'},
  Interior: {bg: 'bg-[#3b82f6]/15',   text: 'text-[#60a5fa]'},
  Exterior: {bg: 'bg-[#8b5cf6]/15',   text: 'text-[#a78bfa]'},
};

const FILTER_TABS = ['All', 'Drying', 'Interior', 'Exterior', 'Active', 'Coming Soon', 'Draft', 'Archived'];

/* ─── Small UI helpers ───────────────────────────────────────────────────── */

function Badge({status, type = 'status'}) {
  const map = type === 'status' ? STATUS_COLORS : CAT_COLORS;
  const label = type === 'status' ? STATUS_LABELS[status] : status;
  const c = map[status] ?? {bg: 'bg-white/10', text: 'text-bc-secondary'};
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-[6px] font-ui text-[0.68rem] tracking-[0.06em] uppercase ${c.bg} ${c.text}`}>
      {label}
    </span>
  );
}

function Field({label, children, required}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-ui text-[0.7rem] tracking-[0.1em] uppercase text-bc-secondary">
        {label}{required && <span className="text-bc-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const INPUT = 'w-full bg-bc-mid border border-bc-divider rounded-[10px] px-3 py-2 font-ui text-[0.85rem] text-white placeholder-bc-secondary/50 focus:outline-none focus:border-bc-red transition-colors duration-150';
const SELECT = INPUT + ' cursor-pointer';
const TEXTAREA = INPUT + ' resize-none';

/* ─── Image upload widget ────────────────────────────────────────────────── */

function ImageUploader({slug, onUploaded, placeholder}) {
  const fetcher = useFetcher();
  const inputRef = useRef(null);
  const uploading = fetcher.state !== 'idle';
  const result = fetcher.data;

  useEffect(() => {
    if (result?.url) onUploaded(result.url);
  }, [result]);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('slug', slug || 'misc');
    fetcher.submit(fd, {method: 'post', encType: 'multipart/form-data'});
  }

  return (
    <div className="flex gap-2 items-center">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex-shrink-0 px-3 py-1.5 rounded-[8px] border border-bc-divider font-ui text-[0.75rem] text-bc-secondary hover:text-white hover:border-white/30 transition-colors duration-150 disabled:opacity-50"
      >
        {uploading ? 'Uploading…' : 'Upload'}
      </button>
      {placeholder && (
        <span className="font-ui text-[0.68rem] text-bc-secondary/50 truncate">{placeholder}</span>
      )}
      {result?.error && (
        <span className="font-ui text-[0.68rem] text-bc-red">{result.error}</span>
      )}
    </div>
  );
}

/* ─── Product form modal ─────────────────────────────────────────────────── */

function ProductModal({product, onClose, onSaved}) {
  const fetcher = useFetcher();
  const isEdit = !!product;
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [mainImg, setMainImg] = useState(product?.main_image_url ?? '');
  const [galleryRaw, setGalleryRaw] = useState(
    (product?.gallery_image_urls ?? []).join('\n'),
  );
  const submitting = fetcher.state !== 'idle';

  /* auto-generate slug from name when creating */
  function handleNameChange(e) {
    if (!isEdit) {
      setSlug(
        e.target.value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
      );
    }
  }

  useEffect(() => {
    if (fetcher.data?.ok) {
      onSaved();
      onClose();
    }
  }, [fetcher.data]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-end">
      {/* backdrop */}
      <div
        className="absolute inset-0"
        style={{background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)'}}
        onClick={onClose}
      />

      {/* panel */}
      <div
        className="relative h-full w-full sm:max-w-[520px] overflow-y-auto flex flex-col"
        style={{
          background: 'rgba(18,18,18,0.97)',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-bc-divider sticky top-0 bg-[#121212] z-10">
          <h2 className="font-display text-[1.4rem] text-white tracking-wide">
            {isEdit ? 'EDIT PRODUCT' : 'NEW PRODUCT'}
          </h2>
          <button
            onClick={onClose}
            className="text-bc-secondary hover:text-white transition-colors p-1"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* form */}
        <fetcher.Form method="post" className="flex-1 px-6 py-6 flex flex-col gap-5">
          <input type="hidden" name="_action" value={isEdit ? 'edit' : 'create'} />
          {isEdit && <input type="hidden" name="id" value={product.id} />}

          {/* Row: Name + Slug */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Product Name" required>
              <input
                className={INPUT}
                name="name"
                defaultValue={product?.name ?? ''}
                onChange={handleNameChange}
                placeholder="CRIMSON"
                required
              />
            </Field>
            <Field label="URL Slug" required>
              <input
                className={INPUT}
                name="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="crimson"
                required
              />
            </Field>
          </div>

          {/* Row: Category + Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Category" required>
              <select className={SELECT} name="category" defaultValue={product?.category ?? 'Drying'}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Status" required>
              <select className={SELECT} name="status" defaultValue={product?.status ?? 'draft'}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Short tagline */}
          <Field label="Short Tagline">
            <input
              className={INPUT}
              name="short_tagline"
              defaultValue={product?.short_tagline ?? ''}
              placeholder="Engineered for one-pass drying."
            />
          </Field>

          {/* Description */}
          <Field label="Description">
            <textarea
              className={TEXTAREA}
              name="description"
              rows={3}
              defaultValue={product?.description ?? ''}
              placeholder="Full product description…"
            />
          </Field>

          {/* Row: Price + Compare at + SKU */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Price (AUD)" required>
              <input
                className={INPUT}
                name="price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={product?.price ?? ''}
                placeholder="80.00"
                required
              />
            </Field>
            <Field label="Compare At">
              <input
                className={INPUT}
                name="compare_at_price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={product?.compare_at_price ?? ''}
                placeholder="—"
              />
            </Field>
            <Field label="SKU">
              <input
                className={INPUT}
                name="sku"
                defaultValue={product?.sku ?? ''}
                placeholder="BC-XXX-01"
              />
            </Field>
          </div>

          {/* Display order */}
          <Field label="Display Order">
            <input
              className={INPUT}
              name="display_order"
              type="number"
              min="0"
              defaultValue={product?.display_order ?? 0}
            />
          </Field>

          {/* Main image */}
          <Field label="Main Image URL">
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  className={INPUT + ' flex-1'}
                  name="main_image_url"
                  value={mainImg}
                  onChange={(e) => setMainImg(e.target.value)}
                  placeholder="/images/product-name.jpg or https://…"
                />
                {mainImg && (
                  <img
                    src={mainImg}
                    alt=""
                    className="w-10 h-10 rounded-[6px] object-cover border border-bc-divider flex-shrink-0"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
              </div>
              <ImageUploader
                slug={slug}
                onUploaded={(url) => setMainImg(url)}
                placeholder="Upload from device"
              />
            </div>
          </Field>

          {/* Gallery images */}
          <Field label="Gallery Image URLs (one per line)">
            <div className="flex flex-col gap-2">
              <textarea
                className={TEXTAREA}
                name="gallery_image_urls"
                rows={4}
                value={galleryRaw}
                onChange={(e) => setGalleryRaw(e.target.value)}
                placeholder={'/images/product-1.jpg\n/images/product-2.jpg\nhttps://…'}
              />
              <ImageUploader
                slug={slug}
                onUploaded={(url) => setGalleryRaw((prev) => (prev ? prev + '\n' + url : url))}
                placeholder="Append gallery image"
              />
            </div>
          </Field>

          {/* Available countries */}
          <Field label="Available Countries">
            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-1">
              {COUNTRIES.map((c) => (
                <label key={c} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="available_countries"
                    value={c}
                    defaultChecked={
                      product
                        ? (product.available_countries ?? COUNTRIES).includes(c)
                        : true
                    }
                    className="accent-bc-red"
                  />
                  <span className="font-ui text-[0.8rem] text-bc-secondary">{c}</span>
                </label>
              ))}
            </div>
          </Field>

          {/* Error */}
          {fetcher.data?.error && (
            <p className="font-ui text-[0.78rem] text-bc-red border border-bc-red/30 bg-bc-red/10 rounded-[8px] px-3 py-2">
              {fetcher.data.error}
            </p>
          )}

          {/* Save */}
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full mt-2 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Product'}
          </button>
        </fetcher.Form>
      </div>
    </div>
  );
}

/* ─── Delete / status confirm inline widget ──────────────────────────────── */

function QuickAction({product, onDone}) {
  const fetcher = useFetcher();
  const [confirm, setConfirm] = useState(null); // 'archive' | 'restore' | 'delete'

  useEffect(() => {
    if (fetcher.data?.ok) { setConfirm(null); onDone(); }
  }, [fetcher.data]);

  if (confirm) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-ui text-[0.72rem] text-bc-secondary whitespace-nowrap">
          {confirm === 'delete' ? 'Delete permanently?' : confirm === 'archive' ? 'Archive product?' : 'Restore to draft?'}
        </span>
        <fetcher.Form method="post" className="inline">
          <input type="hidden" name="_action" value={confirm === 'archive' ? 'set_status' : confirm === 'restore' ? 'set_status' : 'delete'} />
          <input type="hidden" name="id" value={product.id} />
          {(confirm === 'archive') && <input type="hidden" name="status" value="archived" />}
          {(confirm === 'restore') && <input type="hidden" name="status" value="draft" />}
          <button type="submit" className="font-ui text-[0.72rem] text-bc-red hover:text-white transition-colors">
            {fetcher.state !== 'idle' ? '…' : 'Confirm'}
          </button>
        </fetcher.Form>
        <button onClick={() => setConfirm(null)} className="font-ui text-[0.72rem] text-bc-secondary hover:text-white transition-colors">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {product.status !== 'archived' ? (
        <button
          onClick={() => setConfirm('archive')}
          className="font-ui text-[0.72rem] text-bc-secondary hover:text-[#f59e0b] transition-colors"
        >
          Archive
        </button>
      ) : (
        <button
          onClick={() => setConfirm('restore')}
          className="font-ui text-[0.72rem] text-bc-secondary hover:text-[#22c55e] transition-colors"
        >
          Restore
        </button>
      )}
      <button
        onClick={() => setConfirm('delete')}
        className="font-ui text-[0.72rem] text-bc-secondary hover:text-bc-red transition-colors"
      >
        Delete
      </button>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function CatalogueControl() {
  const {products, dbAvailable} = useLoaderData();
  const {revalidate} = useRevalidator();
  const [filter, setFilter] = useState('All');
  const [modal, setModal] = useState(null); // null | 'create' | product object

  const filtered = products.filter((p) => {
    if (filter === 'All') return true;
    if (CATEGORIES.includes(filter)) return p.category === filter;
    if (filter === 'Active')      return p.status === 'active';
    if (filter === 'Coming Soon') return p.status === 'coming_soon';
    if (filter === 'Draft')       return p.status === 'draft';
    if (filter === 'Archived')    return p.status === 'archived';
    return true;
  });

  /* counts for tab badges */
  const counts = {};
  products.forEach((p) => {
    counts.All = (counts.All ?? 0) + 1;
    counts[p.category] = (counts[p.category] ?? 0) + 1;
    const sl = STATUS_LABELS[p.status];
    counts[sl] = (counts[sl] ?? 0) + 1;
  });

  return (
    <div className="min-h-screen bg-bc-bg px-3 py-8 sm:px-6 lg:px-10">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h1 className="font-display text-[2rem] text-white tracking-[0.12em]">
            CATALOGUE CONTROL
          </h1>
          <p className="font-ui text-[0.75rem] text-bc-secondary mt-1">
            {products.length} product{products.length !== 1 ? 's' : ''} total
            {!dbAvailable && (
              <span className="ml-2 text-bc-red">· Database unavailable — run Section 13 SQL</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setModal('create')}
          className="btn-primary flex items-center gap-2 px-5 py-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span className="font-ui text-[0.8rem]">New Product</span>
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap mb-6">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 rounded-[8px] font-ui text-[0.75rem] transition-all duration-150 ${
              filter === tab
                ? 'bg-bc-red/15 text-white border border-bc-red/30'
                : 'text-bc-secondary hover:text-white border border-transparent hover:border-bc-divider'
            }`}
          >
            {tab}
            {counts[tab] != null && (
              <span className="ml-1.5 opacity-50 text-[0.65rem]">{counts[tab]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Products table */}
      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="font-ui text-bc-secondary text-[0.85rem]">
            {dbAvailable ? 'No products in this category.' : 'Run Section 13 of the SQL schema to create the products table.'}
          </p>
          {dbAvailable && (
            <button
              onClick={() => setModal('create')}
              className="mt-4 font-ui text-[0.8rem] text-bc-red hover:text-white transition-colors underline"
            >
              Create your first product
            </button>
          )}
        </div>
      ) : (
        <div className="border border-bc-divider rounded-[14px] overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-bc-divider" style={{background: 'rgba(255,255,255,0.03)'}}>
                <th className="text-left font-ui text-[0.65rem] tracking-[0.12em] uppercase text-bc-secondary px-4 py-3 w-14">
                  IMG
                </th>
                <th className="text-left font-ui text-[0.65rem] tracking-[0.12em] uppercase text-bc-secondary px-4 py-3">
                  Product
                </th>
                <th className="text-left font-ui text-[0.65rem] tracking-[0.12em] uppercase text-bc-secondary px-4 py-3 hidden md:table-cell">
                  Category
                </th>
                <th className="text-left font-ui text-[0.65rem] tracking-[0.12em] uppercase text-bc-secondary px-4 py-3">
                  Status
                </th>
                <th className="text-right font-ui text-[0.65rem] tracking-[0.12em] uppercase text-bc-secondary px-4 py-3 hidden sm:table-cell">
                  Price
                </th>
                <th className="text-right font-ui text-[0.65rem] tracking-[0.12em] uppercase text-bc-secondary px-4 py-3 hidden lg:table-cell">
                  Order
                </th>
                <th className="text-right font-ui text-[0.65rem] tracking-[0.12em] uppercase text-bc-secondary px-4 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product, i) => (
                <tr
                  key={product.id}
                  className={`border-b border-bc-divider/50 transition-colors duration-100 hover:bg-white/[0.03] ${
                    i === filtered.length - 1 ? 'border-b-0' : ''
                  }`}
                >
                  {/* Thumbnail */}
                  <td className="px-4 py-3">
                    <div className="w-10 h-10 rounded-[8px] overflow-hidden bg-bc-mid flex items-center justify-center flex-shrink-0">
                      {product.main_image_url ? (
                        <img
                          src={product.main_image_url}
                          alt={product.name}
                          className="w-full h-full object-cover"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-bc-secondary">
                          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                        </svg>
                      )}
                    </div>
                  </td>

                  {/* Name + slug */}
                  <td className="px-4 py-3">
                    <p className="font-ui text-[0.88rem] text-white">{product.name}</p>
                    <p className="font-ui text-[0.68rem] text-bc-secondary/60 mt-0.5">/{product.slug}</p>
                  </td>

                  {/* Category */}
                  <td className="px-4 py-3 hidden md:table-cell">
                    <Badge status={product.category} type="category" />
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <Badge status={product.status} type="status" />
                  </td>

                  {/* Price */}
                  <td className="px-4 py-3 text-right hidden sm:table-cell">
                    <span className="font-ui text-[0.85rem] text-white">
                      ${Number(product.price).toFixed(2)}
                    </span>
                    {product.compare_at_price && (
                      <span className="ml-2 font-ui text-[0.7rem] text-bc-secondary line-through">
                        ${Number(product.compare_at_price).toFixed(2)}
                      </span>
                    )}
                  </td>

                  {/* Display order */}
                  <td className="px-4 py-3 text-right hidden lg:table-cell">
                    <span className="font-ui text-[0.78rem] text-bc-secondary">{product.display_order}</span>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        onClick={() => setModal(product)}
                        className="font-ui text-[0.72rem] text-bc-secondary hover:text-white transition-colors"
                      >
                        Edit
                      </button>
                      <QuickAction product={product} onDone={revalidate} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Hint */}
      <p className="font-ui text-[0.65rem] text-bc-secondary/40 mt-6 text-center">
        Products set to <strong>Active</strong> appear on the storefront automatically.
        Set status to <strong>Draft</strong> or <strong>Archived</strong> to hide.
      </p>

      {/* Modal */}
      {modal && (
        <ProductModal
          product={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={revalidate}
        />
      )}
    </div>
  );
}
