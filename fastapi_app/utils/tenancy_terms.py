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


def _full_date_display(dt) -> str:
    """'1 September 2026' — no leading zero on the day, full month name.
    Matches the format already used on the dashboard's Move In Date /
    Next Due cards."""
    return f"{dt.day} {dt.strftime('%B %Y')}"


def _current_period_start(entry_date, next_due):
    """The start of the lease period the tenant is CURRENTLY on the books
    for — mirrors the frontend's "Move In Date" card exactly: walk
    entry_date forward a full year at a time until the next anniversary
    would land on or after next_due_date. For a tenant who has renewed,
    this is the renewed period's start, not their original move-in date
    (which next_due_date has long since moved past)."""
    if not entry_date:
        return None
    if not next_due:
        return entry_date
    start = entry_date
    while True:
        try:
            anniversary = start.replace(year=start.year + 1)
        except ValueError:
            anniversary = start.replace(year=start.year + 1, day=28)
        if anniversary < next_due:
            start = anniversary
        else:
            return start


# The operative "NOW IT IS HEREBY AGREED AS FOLLOWS" clauses (the estate
# owner's own tenancy-agreement wording, adopted platform-wide as the
# default). Renders under each tenant's frozen {rent_display} / dates /
# names rather than the underscores this was drafted with.
TERMS_TEMPLATE = [
    "The Landlord lets and the Tenant takes on a daily Tenancy the Apartment in the "
    "Demised Premises at a rent of {rent_display} yearly, translating to approximately "
    "{rent_display_monthly} per month, for the apartment as aforesaid.",
    "That the “Tenant” shall one day before the expiration of the above sum in the "
    "Recitals paid OR ONE DAY BEFORE the anniversary of this tenancy pay his rent either "
    "reviewable or renewable and/or upon any term agreable by the Parties.",
    "This Tenancy agreement, which commences on {start_date_display} to {end_date_display} "
    "is a continuous one except otherwise determined by a -- written NOTICE TO QUIT and/or "
    "failure to religiously abide by the terms created herein regulating the tenancy, "
    "which shall automatically determine the tenancy, upon a seven days notice.",
    "The Tenant agrees that he has examined the Apartment and its appurtenances and that "
    "it was, at the time of the execution of these present, in good order and in "
    "tenantable condition.",
    "The Tenant shall not assign, underlet, sublet, transfer or part with possession of "
    "the “Apartment” and its appurtenances or any part thereof without the prior "
    "written consent of the Landlord, first had and obtained. Upon the tenant committing "
    "the act thereof, the tenancy shall automatically determine.",
    "The Tenant shall apply the Apartment in the Demised Premises in a fair and "
    "tenantable manner and shall not do or permit or suffer to be done on the Demised "
    "Premises/Apartment anything, which may be a nuisance to the Landlord or the other "
    "Residents and/or neighbours and shall apply the Apartment/Demised Premises strictly "
    "for residential purposes, devoid of any taint of commercial purposes.",
    "The Tenant hereby causes to admit that the Landlord shall not provide insurance "
    "coverage for Tenant’s property, nor shall the Landlord be responsible for any loss "
    "of Tenant’s property, whether by theft, fire, acts of God, force, third party "
    "intervention or otherwise.",
    "The Tenant shall comply with all the health and sanitary laws, ordinances, rules and "
    "orders of appropriate governmental authorities and homes associations, if any, with "
    "respect to the Apartment and the Demised Premises.",
    "The Tenant before giving up possession shall cause to invite the Landlord in writing "
    "for the purpose of carrying out a joint inspection of the Apartment and the tenant "
    "shall repair or replace anything that is damaged in the apartment during the tenancy "
    "and shall put the Apartment in a tenantable condition.",
    "The Tenant shall drive no nails or other objects whatsoever into the wall of the "
    "Apartment/Demised Premises without the express written consent of the Landlord, "
    "first had and obtained.",
    "The Tenant shall make no alterations to the Apartment or construct any building or "
    "make other improvements without the prior written consent of the Landlord. Upon the "
    "said breach, the Tenancy shall determined and/or the Tenant shall forfeit such "
    "fixtures to the Landlord, without any lien.",
    "The Tenant shall not be involved in fighting, stealing, trafficking of drugs and any "
    "criminal or illegal activities whatsoever. If the tenant is involved in any or all "
    "of the above vices, the consequences shall be immediate determination of the tenancy "
    "without refund of rent and forfeiture of caution fee.",
    "The Tenant must ensure that all electrical appliances, sockets are switched off and "
    "water taps turned off before leaving the Apartment/Demised Premises at all times.",
    "The Tenant shall not be involved in indiscriminate use of candle light, storage of "
    "fuel (petrol) in the Apartment/Demised Premises.",
    "During the Tenancy, the Tenant shall keep the Apartment in tenantable condition and "
    "repair all the fixtures and fittings and shall also ensure that outside security "
    "lights are always lighted in the evening/night, either with generating set or BEDC.",
    "The Tenant hereby confirm that all fittings in the accommodation are in good and "
    "perfect order and upon any demarcation and/or alteration on the Apartment, the "
    "Tenant shall restore the Apartment to its original and tenantable state upon "
    "determination of the tenancy.",
    "The Tenant shall not cause or constitute nuisance in the Apartment/Demised Premises, "
    "Neither shall he/she disturb the neighbours of the quiet enjoyment of their "
    "Apartment/Residence and upon such act, the Landlord is at liberty to determine the "
    "tenancy sooner or later and the balance rent returned thereto to the tenant.",
    "That the Tenant not willing to continue with his tenancy shall vacate the Apartment "
    "at the end of the month in which the tenancy expires and shall submit the keys to "
    "the Landlord.",
    "The Tenant shall participate in the monthly environmental sanitation on the "
    "Apartment/Demised Premises every last Saturday of the month to be held by the "
    "tenants and the tenant must possess his private/personal refuse bin.",
    "The Tenant shall not under any circumstances use fire or any combustible equipment, "
    "gadget or apparatus in the Apartment/Demised Premises hereby let to him. Such an act "
    "shall automatically lead to the determination of the tenancy.",
    "The tenant who causes any fire incident occasioning damage to the "
    "Apartment/Demised Premises shall undertake the repair or cost of same.",
    "The Tenant who is at liberty to make use of generating set shall put off same at "
    "12:00am (midnight) in accordance with the local security procedures put in place "
    "therein.",
    "The Tenant shall not gain entrance into the Apartment/Demised Premises as from "
    "12:00am (midnight).",
    "The Tenant shall pay security, cleaning of the Demised Premises and other levies "
    "that shall be approved from time to time in the area where the Apartment/Demised "
    "Premises is situate. The Tenants shall also make provision for waste disposal bin "
    "and also make arrangement for its evacuation.",
    "The Tenant shall be responsible for, the security of his Apartment/Demised Premises "
    "and/or properties. The Owner/Landlord admits no liability for theft, burglary and "
    "incidental matters thereto.",
    "The Tenant hereby agrees further with the Landlord that any criminality (including "
    "fighting) shall automatically lead to the determination of the tenancy hereby "
    "created. The Tenant shall also maintain orderliness in parking and removal of his "
    "cars and vehicles and also ensure peaceful co-existence with his neighbours thereof.",
    "The Tenant shall pay his electricity bills monthly and hand over photocopies of the "
    "receipt of payment to the Landlord, whilst keeping the original copy with him for "
    "the records and for the purpose of verification of payment by BEDC officials. The "
    "Tenant shall also ensure that a minimum of 30kw/h is always maintained in its "
    "prepaid meter and for no reason whatsoever make any by-pass thereof.",
    "The Landlord and Landlord’s agents shall have the right at all reasonable times "
    "during the pendency of the terms herein created and any renewal thereto to enter the "
    "Apartment/Demised Premises for the purpose of inspecting the Apartment and/or "
    "examine the state and condition thereof.",
    "The Tenant undertake to promptly drain the soak-away pit/septic tank which is the "
    "responsibility of the tenant whenever same is filled to capacity.",
    "The Tenant before giving up possession, shall paint the interior of the Apartment "
    "and replace all Damaged fixtures and fittings after a joint inspection by the "
    "parties herein to ascertain the state of things as it is.",
    "For security reasons and for the avoidance of any embarrassment, the Tenant shall "
    "promptly disclose the identity/introduce to the Landlord any person coming to spend "
    "a reasonable length of time with him in the Apartment/Demised premises.",
    "The Tenant paying the rent and observing and performing all these obligations under "
    "this agreement, shall quietly enjoy his tenancy without any interruption by the "
    "Landlord, or any person claiming through, under or in trust for the Landlord.",
    "These terms herein created regulate the parties to the title, and any previous "
    "understanding and/or representation is hereby extinguished upon the execution of "
    "these Present.",
]


async def build_parties(db, tenant, estate, unit, owner, next_due_date=None, estate_config=None) -> dict:
    """Frozen snapshot of who/what this agreement is about, at signing time."""
    from models.user import User
    lawyer = await db.get(User, estate.lawyer_id) if estate and estate.lawyer_id else None
    prepared_by = {
        "name": lawyer.name if lawyer else "",
        "address": (lawyer.business_address or "") if lawyer else "",
        "phone": (lawyer.phone or "") if lawyer else "",
        "email": (lawyer.email or "") if lawyer else "",
    }
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
        "rent_display_monthly": _naira(rent / 12),
        "rent_display_daily": _naira(rent / 365),
        "caution_fee": caution,
        "caution_fee_display": _naira(caution),
        "legal_fee": legal,
        "legal_fee_display": _naira(legal),
        "start_date": (tenant.entry_date.isoformat() if tenant.entry_date else None),
        # The CURRENT lease period the tenant is on the books for — not
        # necessarily their original move-in date. A tenant who has since
        # renewed has next_due_date pushed past their first year, so this
        # walks forward to the period that's actually active now, matching
        # the dashboard's own "Move In Date" card exactly.
        "start_date_display": (
            _full_date_display(_current_period_start(tenant.entry_date, tenant.next_due_date))
            if tenant.entry_date else "the tenancy start date"
        ),
        "end_date_display": (
            _full_date_display(tenant.next_due_date) if tenant.next_due_date else "the tenancy end date"
        ),
        "prepared_by_name": prepared_by["name"],
        "prepared_by_address": prepared_by["address"],
        "prepared_by_phone": prepared_by["phone"],
        "prepared_by_email": prepared_by["email"],
    }


class _SafeParties(dict):
    """A missing/mistyped placeholder (e.g. an admin writing {rent_display_daily}
    before that field existed, or any future typo) resolves to an empty
    string instead of raising — so one bad reference degrades that one
    phrase, not the entire clause. Far better for a live legal document than
    either a whole clause silently reverting to raw "{curly braces}", or (the
    old behavior) the tenant seeing programmer syntax in their agreement."""
    def __missing__(self, key):
        return ""


def build_terms(parties: dict, custom_terms: list[str] | None = None) -> list[str]:
    """Interpolate the template with the frozen party details.

    An estate with its own custom_terms (Estate.tenancy_terms, set by the
    property admin/owner) fully replaces the platform default below — this
    estate's whole term set, not a merge. Clauses are still run through
    .format_map(**parties) so an admin can reuse the same {rent_display} /
    {unit_label} placeholders if they want; an unknown placeholder just
    resolves to nothing (see _SafeParties) rather than ever showing raw
    template syntax to a tenant."""
    template = custom_terms if custom_terms else TERMS_TEMPLATE
    safe_parties = _SafeParties(parties)
    resolved = []
    for clause in template:
        try:
            resolved.append(clause.format_map(safe_parties))
        except (IndexError, ValueError):
            resolved.append(clause)
    return resolved
