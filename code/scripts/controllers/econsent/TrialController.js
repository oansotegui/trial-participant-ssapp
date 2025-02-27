import TrialService from '../../services/TrialService.js';
import ConsentStatusMapper from "../../utils/ConsentStatusMapper.js";
import TrialConsentService from "../../services/TrialConsentService.js";

const commonServices = require('common-services');
const DateTimeService = commonServices.DateTimeService;
const BaseRepository = commonServices.BaseRepository;

const {WebcController} = WebCardinal.controllers;

export default class TrialController extends WebcController {
    constructor(...props) {
        super(...props);

        this.model.econsents = [];
        this.model.econsentsAreLoaded = false;
        this.model.tpStatus = [];
        let receivedObject = this.history.win.history.state.state;
        this.model.uid = receivedObject.uid;
        this.model.tpNumber = receivedObject.tpNumber;
        this.model.tpDid = receivedObject.tpDid;
        this._initServices();
        this._initHandlers();
    }

    async _initServices() {
        this.TrialService = new TrialService();
        this.EconsentsStatusRepository =  BaseRepository.getInstance(BaseRepository.identities.PATIENT.ECOSESENT_STATUSES, this.DSUStorage);
        this.TrialParticipantRepository = BaseRepository.getInstance(BaseRepository.identities.PATIENT.TRIAL_PARTICIPANT, this.DSUStorage);
        this.TrialConsentService = new TrialConsentService();
        this.TrialConsentService.getOrCreate((err, trialConsent) => {
            if (err) {
                return console.log(err);
            }
            this.model.trialConsent = trialConsent;
            this._initTrial();
        });
    }

    _initHandlers() {
        this._attachHandlerConsentClick();
        this._attachHandlerSiteClick();
        this._attachHandlerBack();
    }

    _initTrial() {
        this.TrialService.getTrial(this.model.uid, async (err, trial) => {
            if (err) {
                return console.log(err);
            }
            this.model.trial = trial;
            this.model.tpEconsents = [];

            let lastAction = 'Consent required';
            let statusesMappedByConsent = {};
            let statuses = await this.EconsentsStatusRepository.findAllAsync();
            statuses.filter(status => status.tpDid == this.model.tpDid);

            statuses.forEach(status => {
                statusesMappedByConsent[status.foreignConsentId] = status;
            })

            let consents = this.model.trialConsent.volatile?.ifc;
            if (consents === undefined) {
                consents = [];
            }
            this.model.hasConsents = consents.length > 0;
            this.model.econsents = consents?.map(econsent => {
                let importantVersion = econsent.versions.sort((a, b) => new Date(b.versionDate) - new Date(a.versionDate))[0]
                let status = statusesMappedByConsent[econsent.uid];

                if (status && status.actions && status.actions.length > 0) {
                    lastAction = status.actions[status.actions.length - 1].name;
                }
                lastAction = lastAction.split('-')
                    .filter(action => action.length > 0)
                    .map(action => action.charAt(0).toUpperCase() + action.slice(1))
                    .join(" ");

                let lastActionStatus = ConsentStatusMapper.getStatus(lastAction);
                if (lastActionStatus !== undefined) {
                    lastAction = lastActionStatus.displayValue;
                }
                return econsent.versions.length === 0 ? econsent : {
                    ...econsent,
                    versionDateAsString: DateTimeService.convertStringToLocaleDate(importantVersion.versionDate),
                    status: {
                        name: lastAction
                    },
                    ...importantVersion
                }
            })
            this._setTpStatus(statuses);
            if (consents.length > 0) {
                this.model.econsents[0].isMain = true;
            }

            this.TrialParticipantRepository.findAll((err, data) => {
                if (err) {
                    return console.log(err);
                }
                if (data && data.length > 0) {
                    this.model.site = data [0].site;
                }
                this.model.econsentsAreLoaded = true;
            });

        });
    }

    _attachHandlerConsentClick() {
        this.onTagEvent('go-to-econsent', 'click', (model, target, event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.navigateToPageTag('econsent', {
                tpDid: this.model.tpDid,
                trialuid: this.model.uid,
                ecoId: model.uid,
                ecoVersion: model.version,
            });
        });
    }

    _attachHandlerSiteClick() {
        this.onTagClick('go-to-site', (event) => {
            this.navigateToPageTag('site', event.data);
        });
    }

    _attachHandlerBack() {
        this.onTagClick('navigation:go-back', () => {
            this.history.goBack();
        });
    }

    _setTpStatus(consents) {
        consents.forEach((consent) => {
            if (consent.type === 'Mandatory') {
                if (!ConsentStatusMapper.isSigned(consent.actions)) {
                    this.model.econsents[0].required = true;
                }
                this.model.tpStatus = consent.actions.map((action, index) => {
                    return {
                        ...action,
                        index: index + 1,
                    };
                });
            }
        });

    }
}
