import React, { useState } from 'react';
import { ArrowRight, Check, Upload } from 'lucide-react';
import { apiFetch } from '../api';
import type { Organization } from '../types';
import { BrandMark } from './BrandMark';

interface OnboardingWizardProps {
  organization: Organization;
  onCompleted: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  organization,
  onCompleted,
}) => {
  const [step, setStep] = useState(1);
  const [size, setSize] = useState(organization.size || '50-200 employees');
  const [jurisdictions, setJurisdictions] = useState(organization.country || 'Bangladesh');
  const [description, setDescription] = useState(organization.business_description || '');

  const [regulators, setRegulators] = useState('Bangladesh Bank, BFIU, BTRC');
  const [products, setProducts] = useState('Digital Payment Platform, Customer Wallet');
  const [dataCategories, setDataCategories] = useState('Personal Data, Financial Data, KYC Records');
  const [certifications, setCertifications] = useState('ISO 27001, PCI-DSS');

  const [databases, setDatabases] = useState('Transaction DB (PostgreSQL), KYC Vault');
  const [cloudProviders, setCloudProviders] = useState('AWS ap-southeast-1');
  const [securitySystems, setSecuritySystems] = useState('HashiCorp Vault, IAM MFA, Audit Logging');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFinish = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/api/organizations/me/profile', {
        method: 'PUT',
        body: JSON.stringify({
          organization: {
            size,
            operatingJurisdictions: jurisdictions.split(',').map((s) => s.trim()).filter(Boolean),
            businessDescription: description,
          },
          business: {
            products: products.split(',').map((s) => s.trim()).filter(Boolean),
            services: [organization.industry],
            businessActivities: ['Regulated Operations'],
            customerTypes: ['Retail & Business Customers'],
          },
          data: {
            categories: dataCategories.split(',').map((s) => s.trim()).filter(Boolean),
            crossBorderTransfer: false,
          },
          infrastructure: {
            cloudProviders: cloudProviders.split(',').map((s) => s.trim()).filter(Boolean),
            databases: databases.split(',').map((s) => s.trim()).filter(Boolean),
            criticalSystems: ['Core Application API'],
            securitySystems: securitySystems.split(',').map((s) => s.trim()).filter(Boolean),
          },
          compliance: {
            regulators: regulators.split(',').map((s) => s.trim()).filter(Boolean),
            certifications: certifications.split(',').map((s) => s.trim()).filter(Boolean),
            frameworks: ['Internal Control Baseline'],
          },
          completeOnboarding: true,
        }),
      });

      if (selectedFile) {
        const fd = new FormData();
        fd.append('file', selectedFile);
        fd.append('classification', 'Policy');
        fd.append('version', 'v1.0');
        await apiFetch('/api/documents', { method: 'POST', body: fd });
      }

      onCompleted();
    } catch (err: any) {
      setError(err?.message || 'Unable to save onboarding profile.');
    } finally {
      setSaving(false);
    }
  };

  const steps = ['Organization Info', 'Regulatory Exposure', 'Systems', 'Initial Documents'];

  return (
    <div className="min-h-screen bg-[#F4F7FB] py-10 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <BrandMark size="md" />
          <span className="text-xs font-medium text-[#64748B]">
            Workspace Setup · {organization.name}
          </span>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8">
          <div className="flex items-center justify-between mb-8">
            {steps.map((label, index) => {
              const num = index + 1;
              const done = step > num;
              const current = step === num;
              return (
                <div key={label} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      done
                        ? 'bg-emerald-600 text-white'
                        : current
                        ? 'bg-[#2563EB] text-white'
                        : 'bg-[#F1F5F9] text-[#64748B]'
                    }`}
                  >
                    {done ? <Check size={14} /> : num}
                  </div>
                  <span
                    className={`text-xs font-semibold hidden sm:inline ${
                      current ? 'text-[#0F172A]' : 'text-[#64748B]'
                    }`}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-bold text-[#0F172A]">
                01. Organization Information
              </h2>
              <p className="text-sm text-[#64748B]">
                ComplianceOS uses your jurisdiction and operational scope to filter relevant circulars.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#334155] mb-1">
                    Company size
                  </label>
                  <input
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#334155] mb-1">
                    Operating jurisdictions (comma-separated)
                  </label>
                  <input
                    value={jurisdictions}
                    onChange={(e) => setJurisdictions(e.target.value)}
                    className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Business description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-bold text-[#0F172A]">
                02. Regulatory Exposure & Data Categories
              </h2>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Applicable regulators
                </label>
                <input
                  value={regulators}
                  onChange={(e) => setRegulators(e.target.value)}
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Products & regulated services
                </label>
                <input
                  value={products}
                  onChange={(e) => setProducts(e.target.value)}
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Data categories processed
                </label>
                <input
                  value={dataCategories}
                  onChange={(e) => setDataCategories(e.target.value)}
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Current certifications
                </label>
                <input
                  value={certifications}
                  onChange={(e) => setCertifications(e.target.value)}
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-bold text-[#0F172A]">
                03. Systems & Infrastructure
              </h2>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Databases & record stores
                </label>
                <input
                  value={databases}
                  onChange={(e) => setDatabases(e.target.value)}
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Cloud infrastructure
                </label>
                <input
                  value={cloudProviders}
                  onChange={(e) => setCloudProviders(e.target.value)}
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Security & audit systems
                </label>
                <input
                  value={securitySystems}
                  onChange={(e) => setSecuritySystems(e.target.value)}
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-bold text-[#0F172A]">
                04. Upload Baseline Policy or Control Document (Optional)
              </h2>
              <p className="text-sm text-[#64748B]">
                Upload an existing policy, SOP, or risk register to index it for regulatory gap mapping.
              </p>
              <label className="border border-dashed border-[#CBD5E1] rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-[#F8FAFC]">
                <Upload size={22} className="text-[#2563EB] mb-2" />
                <span className="text-sm font-medium text-[#0F172A]">
                  {selectedFile ? selectedFile.name : 'Choose PDF, DOCX, TXT, CSV, or MD file'}
                </span>
                <span className="text-xs text-[#64748B] mt-1">Max 10 MB</span>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
          )}

          <div className="mt-8 pt-5 border-t border-[#E2E8F0] flex items-center justify-between">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="px-4 py-2 text-xs font-semibold text-[#475569] hover:text-[#0F172A] cursor-pointer"
              >
                Previous Step
              </button>
            ) : (
              <div />
            )}

            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className="px-5 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <span>Continue</span>
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={handleFinish}
                className="px-5 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <span>{saving ? 'Finalizing Workspace...' : 'Enter Compliance Dashboard'}</span>
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
