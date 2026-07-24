"""Default tenancy-agreement template — the standard terms shown to every
tenant across every estate, personalized with each tenant's real landlord,
premises, and rent details rather than any one hardcoded deal.

Not a substitute for a lawyer-drafted agreement for a specific property —
it's the platform-wide default a tenant reads and e-signs from their
dashboard. Estate owners who need bespoke clauses should treat this as a
starting point today (a per-estate editor is a natural follow-up, not built
here)."""
from utils.sms_service import format_currency as _naira
from utils.rent_calculator import get_current_rent, resolve_increase_start
from utils.time_utils import utcnow


TERMS_TEMPLATE = [
    "The Tenant shall pay rent of {rent_display} for the {unit_label} at {estate_name} "
    "as agreed with the Landlord, on or before each due date.",
    "The Tenant confirms having inspected the premises and accepts it as being, at the "
    "start of this tenancy, in good and tenantable condition.",
    "This tenancy begins on {start_date_display} and continues on the agreed cycle unless "
    "ended by written notice from either party, or immediately for a serious breach of "
    "these terms.",
    "The Tenant shall not assign, sublet, or transfer possession of the premises, in whole "
    "or in part, without the Landlord's prior written consent.",
    "The premises shall be used strictly for residential purposes and shall not be used "
    "for any commercial, illegal, or nuisance-causing activity.",
    "The Landlord is not responsible for insuring, or for any loss or damage to, the "
    "Tenant's personal property, however caused.",
    "The Tenant shall comply with all applicable health, safety, and sanitation "
    "regulations, and any estate rules communicated by the Landlord or management.",
    "Before vacating, the Tenant shall arrange a joint inspection with the Landlord or "
    "management and shall repair or make good any damage beyond normal wear and tear.",
    "The Tenant shall not make structural alterations, fixtures, or additions to the "
    "premises without the Landlord's prior written consent.",
    "Any involvement by the Tenant in criminal activity on the premises may result in "
    "immediate termination of this tenancy without refund of rent already paid.",
    "The Tenant shall ensure electrical appliances, sockets, and water taps are switched "
    "off when not in use or when the premises are unoccupied.",
    "The Tenant shall not store flammable or hazardous materials on the premises, or use "
    "open flames in a manner that creates a fire risk.",
    "The Tenant shall maintain the premises' fixtures and fittings in good order for the "
    "duration of the tenancy.",
    "Any damage to the premises caused by the Tenant's negligence — including fire, water "
    "damage, or misuse of fittings — shall be repaired at the Tenant's cost.",
    "The Tenant shall not cause a nuisance or disturb neighbouring occupants' quiet "
    "enjoyment of their own units.",
    "The Tenant intending not to renew this tenancy shall give notice as agreed and vacate "
    "the premises by the end of the tenancy period, returning all keys to the Landlord.",
    "The Landlord or an authorised representative may enter the premises at reasonable "
    "times, with prior notice, to inspect condition or carry out necessary repairs.",
    "The Tenant is responsible for the security of their own property within the "
    "premises; the Landlord accepts no liability for theft or burglary.",
    "The Tenant shall pay utility bills (including electricity) attributable to the unit "
    "promptly and provide proof of payment to the Landlord or management on request.",
    "Where the premises has a prepaid meter or similar utility arrangement, the Tenant "
    "shall keep it adequately funded and shall not tamper with or bypass it.",
    "The Tenant shall promptly inform the Landlord or management of any person residing "
    "with them for an extended period, for security and record purposes.",
    "So long as the Tenant pays rent and observes these terms, they shall enjoy quiet "
    "possession of the premises without interruption from the Landlord.",
    "These terms represent the whole of the agreement between the parties on this tenancy "
    "and supersede any prior discussion or understanding on the same subject.",
]


# BamiHost's retained solicitor — named on every tenancy agreement platform-
# wide (confirmed with the owner: not one landlord's private counsel, but
# BamiHost's counsel for every estate's agreements).
PREPARED_BY = {
    "name": "G. Anukun Esq., LL.M, AICMC",
    "address": "No. 12 Deco Road, by Efejuku Street Junction, Warri, Delta State.",
    "phone": "08050696537, 08068202655",
    "email": "godfreyanukun@gmail.com",
}


def build_parties(tenant, estate, unit, owner, next_due_date=None, estate_config=None) -> dict:
    """Frozen snapshot of who/what this agreement is about, at signing time."""
    # The tenant's actual periodic obligation is THIS YEAR's rent + service
    # charge — not next year's projected renewal total, and not rent alone.
    # Escalate from base_* (same as process_tenant/dashboard's "this year"
    # figure) rather than trust rent_amount/service_charge_amount directly,
    # since those are only refreshed when the rent-increase scheduler runs.
    _rate, _cycle, _start = estate_config or (None, None, None)
    _start = resolve_increase_start(tenant, _start)
    origin = getattr(tenant, "entry_date", None) or getattr(tenant, "created_at", None) or utcnow()
    rent_base = getattr(tenant, "base_rent", None) or getattr(tenant, "rent_amount", 0) or 0
    svc_base = getattr(tenant, "base_service_charge", None) or getattr(tenant, "service_charge_amount", 0) or 0
    current_rent = get_current_rent(rent_base, origin, False, _rate, _cycle, _start)
    current_service = get_current_rent(svc_base, origin, False, _rate, _cycle, _start) if svc_base else 0
    rent = float(current_rent) + float(current_service)
    caution = float(getattr(unit, "caution_fee", 0) or 0) if unit else 0
    legal = float(getattr(unit, "legal_fee", 0) or 0) if unit else 0
    bedrooms = getattr(unit, "bedrooms", 0) or 0 if unit else 0
    bedroom_count = (
        f"{bedrooms}-Bedroom" if bedrooms
        else (getattr(unit, "category", "") if unit else "") or "Apartment"
    )
    return {
        "landlord_name": (owner.name if owner else None) or estate.name or "The Landlord",
        "estate_name": estate.name or "",
        "estate_address": estate.address or "",
        "tenant_name": tenant.tenant_name or "",
        "tenant_email": tenant.tenant_email or "",
        "tenant_phone": tenant.tenant_phone or "",
        "unit_label": tenant.unit_label or (unit.label if unit else ""),
        "bedroom_count": bedroom_count,
        "rent_amount": rent,
        "rent_display": _naira(rent),
        "caution_fee": caution,
        "caution_fee_display": _naira(caution),
        "legal_fee": legal,
        "legal_fee_display": _naira(legal),
        "start_date": (tenant.entry_date.isoformat() if tenant.entry_date else None),
        "start_date_display": (tenant.entry_date.strftime("%d %b %Y") if tenant.entry_date else "the tenancy start date"),
        "prepared_by_name": PREPARED_BY["name"],
        "prepared_by_address": PREPARED_BY["address"],
        "prepared_by_phone": PREPARED_BY["phone"],
        "prepared_by_email": PREPARED_BY["email"],
    }


def build_terms(parties: dict) -> list[str]:
    """Interpolate the template with the frozen party details."""
    return [clause.format(**parties) for clause in TERMS_TEMPLATE]
