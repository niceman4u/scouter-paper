import React, {Component} from "react";
import "./Paper.css";
import "./Resizable.css";
import {connect} from "react-redux";
import {withRouter} from 'react-router-dom';
import {addRequest, pushMessage, setControlVisibility, setRealTime, setRealTimeValue, setRangeDate, setRangeHours, setRangeMinutes, setRangeValue, setRangeDateHoursMinutes, setRangeDateHoursMinutesValue, setRangeAll, setTemplate} from "../../actions";
import {Responsive, WidthProvider} from "react-grid-layout";
import {Box, BoxConfig, PaperControl, XLogFilter} from "../../components";
import jQuery from "jquery";
import {errorHandler, getData, getHttpProtocol, getWithCredentials, setAuthHeader, setData, getSearchDays, getDivideDays, getCurrentUser} from "../../common/common";
import Profiler from "./XLog/Profiler/Profiler";
import ServerDate from "../../common/ServerDate";
import * as common from "../../common/common";
import RangeControl from "./RangeControl/RangeControl";
import moment from "moment";
import _ from "lodash";
import notificationIcon from '../../img/notification.png';
import OldVersion from "../OldVersion/OldVersion";

const ResponsiveReactGridLayout = WidthProvider(Responsive);

class Paper extends Component {
    mountTime = null;
    dataRefreshTimer = null;
    xlogHistoryRequestTime = null;
    mounted = false;
    xlogHistoryTemp = [];
    xlogHistoryTotalDays = 0;
    xlogHistoryCurrentDays = 0;

    lastFrom = null;
    lastTo = null;

    needSearch = false;
    needSearchFrom = null;
    needSearchTo = null;

    boxesRef = {};

    alertTimer = null;

    constructor(props) {
        super(props);
        this.mountTime = (new Date()).getTime();
        this.counterHistoriesLoaded = {};
        this.counterReady = false;

        let layouts = getData("layouts");
        let boxes = getData("boxes");

        if (!(layouts)) {
            layouts = {};
        }

        if (!boxes) {
            boxes = [];
        }        

        let range = 1000 * 60 * 10;
        let endTime = (new ServerDate()).getTime();
        let startTime = endTime - range;

        let alertInfo = JSON.parse(localStorage.getItem("alert"));

        //URL로부터 XLOG 응답시간 축 시간 값 세팅
        let xlogElapsedTime = common.getParam(this.props, "xlogElapsedTime");

        //URL로부터 layout 세팅
        let layout = common.getParam(this.props, "layout");
        if (layout) {
            jQuery.ajax({
                method: "GET",
                async: true,
                url: getHttpProtocol(this.props.config) + "/scouter/v1/kv/__scouter_paper_layout",
                xhrFields: getWithCredentials(this.props.config),
                beforeSend: (xhr) => {
                    setAuthHeader(xhr, this.props.config, getCurrentUser(this.props.config, this.props.user));
                }
            }).done((msg) => {
                if (msg && Number(msg.status) === 200) {
                    let templates = JSON.parse(msg.result);
                    for (let i=0; i<templates.length; i++) {
                        if (layout === templates[i].name) {
                            this.props.setTemplate(templates[i].boxes, templates[i].layouts);
                            break;
                        }
                    }
                }
            }).fail((xhr, textStatus, errorThrown) => {
                errorHandler(xhr, textStatus, errorThrown, this.props);
            });
        }

        // URL로부터 range 컨트럴의 데이터를 세팅
        let params = common.getParam(this.props, "realtime,longterm,from,to");

        let now = moment();
        let from = now.clone().subtract(10, "minutes");
        let to = now;
        if (params[2] && params[3]) {
            if (params[2].length === 14 && params[3].length === 14) {
                from = moment(params[2], "YYYYMMDDhhmmss");
                to = moment(params[3], "YYYYMMDDhhmmss");
            } else {
                from = moment(Number(params[2]));
                to = moment(Number(params[3]));
            }

            let value = Math.floor((to.valueOf() - from.valueOf()) / (1000 * 60));
            // 전달된 범위가 최소 범위보다 작을 경우, 최소 범위로 조회
            if (value < this.props.config.range.shortHistoryStep) {
                value = this.props.config.range.shortHistoryStep;
                to = from.clone().add(value, "minutes");
            }

            if (!isNaN(value)) {
                this.props.setRangeDateHoursMinutesValue(from, from.hours(), from.minutes(), value);
                this.needSearch = true;
                this.needSearchFrom = from.valueOf();
                this.needSearchTo = to.valueOf();
            }
        }

        if (params[0] || params[0] === null) {//realtime
            this.props.setRealTime(true, false);
            common.setRangePropsToUrl(this.props);
        } else {
            if (params[1]) {//longterm
                this.props.setRealTime(false, true);
            } else {
                //no longterm param then check config
                if(params[1] === undefined || params[1] === null) {
                    const shortLimitMillis = this.props.config.range.shortHistoryRange * 60 * 1000;
                    if(shortLimitMillis && shortLimitMillis < to.diff(from)) {
                        this.props.setRealTime(false, true);
                    } else {
                        this.props.setRealTime(false, false);
                    }
                } else {
                    this.props.setRealTime(false, false);
                }
            }
        }

        if (params[2] && params[3]) {
            let value = Math.floor((to.valueOf() - from.valueOf()) / (1000 * 60));
            if (!isNaN(value)) {
                this.props.setRangeDateHoursMinutesValue(from, from.hours(), from.minutes(), value);
                this.needSearch = true;
                this.needSearchFrom = from.valueOf();
                this.needSearchTo = to.valueOf();
            }
        }

        this.state = {
            layouts: layouts,
            layoutChangeTime: null,
            boxes: boxes,
            filters : [],

            data: {
                tempXlogs: [],
                firstStepXlogs: [],
                firstStepTimestamp: null,
                secondStepXlogs: [],
                secondStepTimestamp: null,
                xlogs: [],
                newXLogs: [],
                offset1: 0,
                offset2: 0,
                startTime: startTime,
                endTime: endTime,
                range: range,
                maxElapsed: 2000,
                paramMaxElapsed : xlogElapsedTime,
                lastRequestTime: null,
                clearTimestamp: null
            },
            xlogHistoryDoing : false,
            xlogHistoryRequestCnt : 0,
            xlogNotSupportedInRange : false,

            pastTimestamp: null,

            /* visitor */
            visitor: {},

            /* counters */
            counters: {
                time: null,
                data: null
            },

            /* counters past data */
            countersHistory: {
                time: null,
                data: null,
                from: null,
                to: null
            },

            fixedControl: false,
            visible: true,
            rangeControl: false,
            alert: {
                data: [],
                offset: {},
                clearTime: alertInfo ? alertInfo.clearTime : null,
                clearItem: alertInfo ? alertInfo.clearItem : {}
            },
            showAlert: false
        };
    }

    componentDidUpdate = (prevProps, prevState) => {

        let counterKeyMap = {};
        for (let i = 0; i < this.state.boxes.length; i++) {
            let option = this.state.boxes[i].option;

            if (option && option.length > 0) {
                for (let j = 0; j < option.length; j++) {
                    let innerOption = option[j];
                    if (innerOption.type === "counter") {
                        counterKeyMap[innerOption.counterKey] = true;
                    }
                }
            }
        }

        let prevCounterKeyMap = {};
        for (let i = 0; i < prevState.boxes.length; i++) {
            let option = prevState.boxes[i].option;

            if (option && option.length > 0) {
                for (let j = 0; j < option.length; j++) {
                    let innerOption = option[j];
                    if (innerOption.type === "counter") {
                        prevCounterKeyMap[innerOption.counterKey] = true;
                    }
                }
            }
        }

        // 카운터들이 변경되었을때, 다시 조회
        if (JSON.stringify(prevCounterKeyMap) !== JSON.stringify(counterKeyMap)) {
            if (this.props.range.realTime) {
                let now = (new ServerDate()).getTime();
                let ten = 1000 * 60 * 10;
                this.getCounterHistory(this.props.objects, now - ten, now, false);
                this.getLatestData(true, this.props.objects);
            } else {
                if (this.needSearch && this.props.objects && this.props.objects.length > 0) {
                    this.needSearch = false;
                    this.search(this.needSearchFrom, this.needSearchTo, this.props.objects);
                } else {
                    if (this.lastFrom && this.lastTo) {
                        this.getXLogHistory(this.lastFrom, this.lastTo, this.props.objects, this.props.range.longTerm);
                    }
                }
            }
        }

    };

    componentWillReceiveProps(nextProps) {

        if (JSON.stringify(nextProps.template) !== JSON.stringify(this.props.template)) {
            if (JSON.stringify(nextProps.template.boxes) !== JSON.stringify(this.state.boxes) || JSON.stringify(nextProps.template.layouts) !== JSON.stringify(this.state.layouts)) {
                this.setState({
                    layouts: nextProps.template.layouts,
                    layoutChangeTime: (new Date()).getTime(),
                    boxes: nextProps.template.boxes,
                });
            }
        }

        if (JSON.stringify(this.props.objects) !== JSON.stringify(nextProps.objects)) {
            if (this.props.range.realTime) {
                let now = (new ServerDate()).getTime();
                let ten = 1000 * 60 * 10;
                this.getCounterHistory(nextProps.objects, now - ten, now, false);
                this.getLatestData(true, nextProps.objects);
            } else {
                if (this.needSearch) {
                    this.needSearch = false;
                    this.search(this.needSearchFrom, this.needSearchTo, nextProps.objects);
                } else {
                    if (this.lastFrom && this.lastTo) {
                        this.getXLogHistory(this.lastFrom, this.lastTo, nextProps.objects, this.props.range.longTerm);
                    }
                }
            }
        }

        if (JSON.stringify(this.props.objects) !== JSON.stringify(nextProps.objects) || JSON.stringify(this.props.user) !== JSON.stringify(nextProps.user) || JSON.stringify(this.props.config) !== JSON.stringify(nextProps.config)) {
            this.checkRealtimeAlert();
        }

        if (this.props.range.realTime !== nextProps.range.realTime) {
            this.setState({
                counters: {
                    time: null,
                    data: null
                },
                countersHistory: {
                    time: null,
                    data: null,
                    from: null,
                    to: null
                }
            });

            if (nextProps.range.realTime) {
                this.counterHistoriesLoaded = {};
                clearInterval(this.dataRefreshTimer);
                this.dataRefreshTimer = null;

                let now = (new ServerDate()).getTime();
                let ten = 1000 * 60 * 10;
                this.getCounterHistory(this.props.objects, now - ten, now, false);
                this.getLatestData(true, this.props.objects);
            } else {
                clearInterval(this.dataRefreshTimer);
                this.dataRefreshTimer = null;
            }
        }

        if (JSON.stringify(this.props.objects) !== JSON.stringify(nextProps.objects) || JSON.stringify(this.props.range) !== JSON.stringify(nextProps.range)) {
            common.setRangePropsToUrl(nextProps);
        }

    }

    componentDidMount() {
        this.mounted = true;

        if (this.props.objects && this.props.objects.length > 0) {
            let now = (new ServerDate()).getTime();
            let ten = 1000 * 60 * 10;
            this.getCounterHistory(this.props.objects, now - ten, now, false);
            if (this.props.range.realTime) {
                this.getLatestData(false, this.props.objects);
            }
        }

        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 1000);

        document.addEventListener("scroll", this.scroll.bind(this));
        document.addEventListener('visibilitychange', this.visibilitychange.bind(this));

        this.setState({
            visible: document.visibilityState === 'visible'
        });

        if (this.props.config.alert.notification === "Y") {
            if (Notification && (Notification.permission !== "granted" || Notification.permission === "denied")) {
                Notification.requestPermission();
            }
        }

        this.checkRealtimeAlert();
    }

    checkRealtimeAlert = () => {
        if (this.alertTimer === null) {
            let seconds = this.props.config.alertInterval;
            if (!seconds) {
                seconds = 60;
            }
            this.alertTimer = setInterval(() => {
                this.getRealTimeAlert(this.props.objects);
            }, seconds * 1000);
        }
    };

    componentWillUnmount() {
        this.mounted = false;
        clearInterval(this.dataRefreshTimer);
        this.dataRefreshTimer = null;

        clearInterval(this.alertTimer);
        this.alertTimer = null;

        document.removeEventListener("scroll", this.scroll.bind(this));
        document.removeEventListener('visibilitychange', this.visibilitychange.bind(this));
    }

    getLatestData(clear, objects) {
        if (clear) {
            // SEARCH 옵션으로 한번이라도 조회했다면 지우고 다시
            if (this.state.pastTimestamp) {
                this.getXLog(true, objects);
            } else {
                // SEARCH에서 다시 REALTIME인 경우 이어서
                this.getXLog(clear, objects);
            }
        } else {
            this.getXLog(false, objects);
        }

        this.getVisitor();
        this.getRealTimeCounter();

        clearInterval(this.dataRefreshTimer);
        this.dataRefreshTimer = null;

        this.dataRefreshTimer = setTimeout(() => {
            this.getLatestData(false, objects);
        }, this.props.config.interval);

    }


    getRealTimeCounter = () => {
        const that = this;

        if (this.props.objects && this.props.objects.length > 0) {
            let counterKeyMap = {};
            for (let i = 0; i < this.state.boxes.length; i++) {
                let option = this.state.boxes[i].option;

                if (option && option.length > 0) {
                    for (let j = 0; j < option.length; j++) {
                        let innerOption = option[j];
                        if (innerOption.type === "counter") {
                            counterKeyMap[innerOption.counterKey] = true;
                        }
                    }
                } else if (option && option.type === "ActiveSpeed") {
                    counterKeyMap[option.counterKey] = true;
                }
            }

            let counterKeys = [];
            for (let attr in counterKeyMap) {
                counterKeys.push(attr);
            }

            if (counterKeys.length < 1) {
                return false;
            }

            this.counterReady = counterKeys.filter((key) => key !== "ActiveSpeed").every((key) => this.counterHistoriesLoaded[key]);

            if (this.counterReady) {
                let params = JSON.stringify(counterKeys.map((key) => encodeURI(key)));
                params = params.replace(/"/gi, "");
                this.props.addRequest();
                jQuery.ajax({
                    method: "GET",
                    async: true,
                    url: getHttpProtocol(this.props.config) + '/scouter/v1/counter/realTime/' + params + '?objHashes=' + JSON.stringify(this.props.objects.map((obj) => {
                        return Number(obj.objHash);
                    })),
                    xhrFields: getWithCredentials(that.props.config),
                    beforeSend: function (xhr) {
                        setAuthHeader(xhr, that.props.config, getCurrentUser(that.props.config, that.props.user));
                    }
                }).done((msg) => {
                    if (!that.mounted) {
                        return;
                    }
                    let map = {};

                    for (let i = 0; i < counterKeys.length; i++) {
                        map[counterKeys[i]] = {};
                    }

                    if (msg.result) {
                        for (let i = 0; i < msg.result.length; i++) {
                            let counter = msg.result[i];
                            map[counter.name][counter.objHash] = counter;
                        }
                    }

                    this.setState({
                        counters: {
                            time: (new ServerDate()).getTime(),
                            data: map
                        }
                    });
                }).fail((xhr, textStatus, errorThrown) => {
                    errorHandler(xhr, textStatus, errorThrown, this.props);
                });
            } else {
                let now = (new ServerDate()).getTime();
                let ten = 1000 * 60 * 10;
                this.getCounterHistory(this.props.objects, now - ten, now, false);
            }
        }
    };

    toggleShowAlert = () => {
        this.setState({
            showAlert : !this.state.showAlert
        });
    };

    clearAllAlert = () => {
        let clearTime;
        let clearItem;
        if (this.state.alert.data && this.state.alert.data.length > 0) {
            let last = this.state.alert.data[0];
            clearTime = Number(last.time);
            clearItem = {};
        } else {
            clearTime = (new Date()).getTime();
            clearItem = {};
        }

        this.setState({
            alert: {
                data : [],
                offset : this.state.alert.offset,
                clearTime: clearTime,
                clearItem: clearItem
            },
            showAlert : false
        });

        if (localStorage) {
            localStorage.setItem("alert", JSON.stringify({
                clearTime: clearTime,
                clearItem: clearItem
            }));
        }
    };

    clearOneAlert = (objHash, time) => {

        let clearItem = this.state.alert.clearItem;

        if (!clearItem[objHash]) {
            clearItem[objHash] = {};
        }

        clearItem[objHash][time] = true;

        let data = this.state.alert.data;
        if (data && data.length > 0) {
            for (let i=0; i<data.length; i++) {
                if (data[i].objHash === objHash && Number(data[i].time) === Number(time)) {
                    data.splice(i, 1);
                    break;
                }
            }
        }

        this.setState({
            alert : {
                data: data,
                offset: this.state.alert.offset,
                clearTime: this.state.alert.clearTime,
                clearItem: clearItem
            }
        });

        if (localStorage) {
            localStorage.setItem("alert", JSON.stringify({
                clearTime: this.state.alert.clearTime,
                clearItem: clearItem
            }));
        }
    };

    setRewind = (time) => {
        let start = moment(Math.floor(time / (1000 * 60)) * (1000 * 60));
        start.subtract(5, "minutes");
        let end = start.clone().add(10, "minutes");
        this.props.setRangeAll(start, start.hours(), start.minutes(), 10, false, false, this.props.config.range.shortHistoryRange, this.props.config.range.shortHistoryStep);
        setTimeout(() => {
            this.search(start, end, this.props.objects);
        }, 100);

    };

    getRealTimeAlert = (objects) => {
        const that = this;

        let objTypes = [];
        if (objects && objects.length > 0) {
            objTypes = _.chain(objects).map((d) => d.objType).uniq().value();
        }

        if (objTypes && objTypes.length > 0) {
            objTypes.forEach((objType) => {
                this.props.addRequest();

                let offset1 = this.state.alert.offset[objType] ? this.state.alert.offset[objType].offset1 : 0;
                let offset2 = this.state.alert.offset[objType] ? this.state.alert.offset[objType].offset2 : 0;

                jQuery.ajax({
                    method: "GET",
                    async: true,
                    url: getHttpProtocol(this.props.config) + "/scouter/v1/alert/realTime/" + offset1 + "/" + offset2 + "?objType=" + objType,
                    xhrFields: getWithCredentials(that.props.config),
                    beforeSend: function (xhr) {
                        setAuthHeader(xhr, that.props.config, getCurrentUser(that.props.config, that.props.user));
                    }
                }).done((msg) => {
                    if (msg) {

                        let alert = this.state.alert;
                        if (!alert.offset[objType]) {
                            alert.offset[objType] = {};
                        }

                        alert.offset[objType].offset1 = msg.result.offset1;
                        alert.offset[objType].offset2 = msg.result.offset2;
                        alert.data = alert.data.concat(msg.result.alerts);

                        if (alert.data.length > 0) {
                            alert.data = alert.data.sort((a, b) => {
                                return Number(b.time) - Number(a.time)
                            });

                            alert.data = alert.data.filter((alert) => {
                                if (this.state.alert.clearTime) {
                                    if (this.state.alert.clearTime >= Number(alert.time)) {
                                        return false;
                                    } else {
                                        if (this.state.alert.clearItem[alert.objHash] && this.state.alert.clearItem[alert.objHash][alert.time]) {
                                            return false;
                                        } else {
                                            return true;
                                        }
                                    }
                                } else {
                                    if (this.state.alert.clearItem[alert.objHash] && this.state.alert.clearItem[alert.objHash][alert.time]) {
                                        return false;
                                    } else {
                                        return true;
                                    }
                                }
                            });

                            if (Notification && this.props.config.alert.notification === "Y" && Notification.permission === "granted") {
                                for (let i=0; i<alert.data.length; i++) {
                                    if (Number(alert.data[i].time) > this.mountTime && !alert.data[i]["_notificated"]) {
                                        alert.data[i]["_notificated"] = true;

                                        var options = {
                                            body: alert.data[i].objName + "\n" + alert.data[i].message,
                                            icon: notificationIcon
                                        };
                                        new Notification("[" + alert.data[i].level + "]" +  alert.data[i].title, options);
                                    }
                                }
                            }

                            this.setState({
                                alert: alert
                            });
                        }
                    }
                }).fail((xhr, textStatus, errorThrown) => {
                    clearInterval(this.alertTimer);
                    this.alertTimer = null;
                    errorHandler(xhr, textStatus, errorThrown, this.props);
                });
            });
        }
    };


    getCounterHistory = (objects, from, to, longTerm) => {

        if (objects && objects.length > 0) {
            let counterKeyMap = {};
            let counterHistoryKeyMap = {};

            for (let i = 0; i < this.state.boxes.length; i++) {
                let option = this.state.boxes[i].option;

                if (option && option.length > 0) {
                    for (let j = 0; j < option.length; j++) {
                        let innerOption = option[j];
                        if (innerOption.type === "counter") {
                            counterKeyMap[innerOption.counterKey] = true;
                            counterHistoryKeyMap[innerOption.counterKey] = {
                                key : innerOption.counterKey,
                                familyName : innerOption.familyName
                            };
                        }
                    }
                }
            }

            let counterKeys = [];
            for (let attr in counterKeyMap) {
                counterKeys.push(attr);
            }

            let counterHistoryKeys = [];
            for (let attr in counterHistoryKeyMap) {
                counterHistoryKeys.push(counterHistoryKeyMap[attr]);
            }

            if (counterKeys.length < 1) {
                return false;
            }

            for (let i = 0; i < counterHistoryKeys.length; i++) {
                let counterKey = counterHistoryKeys[i].key;
                let familyName = counterHistoryKeys[i].familyName;
                let now = (new Date()).getTime();
                let startTime = from;
                let endTime = to;
                let url;
                if (longTerm) {

                    url = getHttpProtocol(this.props.config) + '/scouter/v1/counter/stat/' + encodeURI(counterKey) + '?objHashes=' + JSON.stringify(objects.filter((d) => {
                        return d.objFamily === familyName;
                    }).map((obj) => {
                            return Number(obj.objHash);
                        })) + "&startYmd=" + moment(startTime).format("YYYYMMDD") + "&endYmd=" + moment(endTime).format("YYYYMMDD");
                    this.getCounterHistoryData(url, counterKey, from, to, now, false);

                } else {
                    url = getHttpProtocol(this.props.config) + '/scouter/v1/counter/' + encodeURI(counterKey) + '?objHashes=' + JSON.stringify(objects.filter((d) => {
                        return d.objFamily === familyName;
                    }).map((obj) => {
                            return Number(obj.objHash);
                        })) + "&startTimeMillis=" + startTime + "&endTimeMillis=" + endTime;
                    this.getCounterHistoryData(url, counterKey, from, to, now, false);
                }
            }
        }
    };

    changeLongTerm = (longTerm) => {
        this.setState({
            longTerm: longTerm
        });
    };

    setLoading = (visible) => {
        if (visible) {
            this.refs.loading.style.display = "table";
            this.refs.loading.style.opacity = "1";
        } else {
            setTimeout(() => {
                if (this.refs.loading) {
                    this.refs.loading.style.opacity = "0";
                    this.refs.loading.style.display = "none";
                }
            }, 300);
        }
    };

    search = (from, to, objects) => {

        this.lastFrom = from;
        this.lastTo = to;

        this.setState({
            countersHistory: {
                time: null,
                data: null,
                from: from,
                to: to
            }
        });

        this.getCounterHistory(objects || this.props.objects, from, to, this.props.range.longTerm);
        this.getXLogHistory(from, to, objects || this.props.objects, this.props.range.longTerm);

    };

    scroll = () => {
        if (document.documentElement.scrollTop > 60) {
            this.setState({
                fixedControl: true
            });
        } else {
            this.setState({
                fixedControl: false
            });
        }
    };

    visibilitychange = () => {
        this.setState({
            visible: document.visibilityState === 'visible'
        });
    };

    sampling = (data) => {
        return data.filter((d) => {
            if (Number(d.error)) {
                return Math.round(Math.random() * 100) > (100 - this.props.config.xlog.error.sampling);
            } else {
                return Math.round(Math.random() * 100) > (100 - this.props.config.xlog.normal.sampling);
            }
        })
    };

    getXLog = (clear, objects) => {
        let that = this;
        if (objects && objects.length > 0) {
            this.props.addRequest();
            jQuery.ajax({
                method: "GET",
                async: true,
                dataType: 'text',
                url: getHttpProtocol(this.props.config) + '/scouter/v1/xlog/realTime/' + (clear ? 0 : this.state.data.offset1) + '/' + (clear ? 0 : this.state.data.offset2) + '?objHashes=' + JSON.stringify(objects.map((instance) => {
                    return Number(instance.objHash);
                })),
                xhrFields: getWithCredentials(that.props.config),
                beforeSend: function (xhr) {
                    setAuthHeader(xhr, that.props.config, getCurrentUser(that.props.config, that.props.user));
                }
            }).done((msg) => {

                if (!msg) {
                    return;
                }

                let result = (JSON.parse(msg)).result;

                let now = (new ServerDate()).getTime();

                let datas = null;
                if (Number(this.props.config.xlog.normal.sampling) !== 100 || Number(this.props.config.xlog.error.sampling) !== 100) {
                    datas = this.sampling(result.xlogs);
                } else {
                    datas = result.xlogs;
                }

                let tempXlogs = this.state.data.tempXlogs.concat(datas);
                let data = this.state.data;

                data.offset1 = result.xlogLoop;
                data.offset2 = result.xlogIndex;
                data.tempXlogs = tempXlogs;
                data.lastRequestTime = now;

                let endTime = (new ServerDate()).getTime();
                let startTime = endTime - this.state.data.range;

                let firstStepStartTime = this.state.data.lastRequestTime - 1000;
                let secondStepStartTime = firstStepStartTime - 5000;

                this.removeOverTimeXLogFrom(data.tempXlogs, startTime);
                if (!this.state.visible) {
                    this.setState({
                        data: data
                    });
                    return;
                }

                let xlogs = clear ? [] : this.state.data.xlogs;
                let newXLogs = clear ? [] : this.state.data.newXLogs;
                let firstStepXlogs = clear ? [] : this.state.data.firstStepXlogs;
                let secondStepXlogs = clear ? [] : this.state.data.secondStepXlogs;
                let lastStepXlogs = [];

                for (let i = 0; i < secondStepXlogs.length; i++) {
                    let d = secondStepXlogs[i];
                    if (d.endTime >= firstStepStartTime) {
                        firstStepXlogs.push(secondStepXlogs.splice(i, 1)[0]);
                    } else if (d.endTime >= secondStepStartTime && d.endTime < firstStepStartTime) {

                    } else {
                        lastStepXlogs.push(secondStepXlogs.splice(i, 1)[0]);
                    }
                }


                for (let i = 0; i < firstStepXlogs.length; i++) {
                    let d = firstStepXlogs[i];
                    if (d.endTime >= firstStepStartTime) {

                    } else if (d.endTime >= secondStepStartTime && d.endTime < firstStepStartTime) {
                        secondStepXlogs.push(firstStepXlogs.splice(i, 1)[0]);
                    } else {
                        lastStepXlogs.push(firstStepXlogs.splice(i, 1)[0]);
                    }
                }

                for (let i = 0; i < tempXlogs.length; i++) {
                    let d = tempXlogs[i];
                    if (d.endTime >= firstStepStartTime) {
                        firstStepXlogs.push(d);
                    } else if (d.endTime >= secondStepStartTime && d.endTime < firstStepStartTime) {
                        secondStepXlogs.push(d);
                    } else {
                        lastStepXlogs.push(d);
                    }
                }

                xlogs = xlogs.concat(newXLogs);
                newXLogs = lastStepXlogs;

                this.removeOverTimeXLogFrom(xlogs, startTime);

                data.tempXlogs = [];
                data.firstStepXlogs = firstStepXlogs;
                data.firstStepTimestamp = now;
                data.secondStepXlogs = secondStepXlogs;
                data.secondStepTimestamp = now;
                data.xlogs = xlogs;
                data.newXLogs = newXLogs;
                data.startTime = startTime;
                data.endTime = endTime;
                data.pastTimestamp = null;
                data.clearTimestamp = clear ? (new Date()).getTime() : data.clearTimestamp;
                this.setState({
                    data: data,
                    xlogNotSupportedInRange: false
                });

            }).fail((xhr, textStatus, errorThrown) => {
                errorHandler(xhr, textStatus, errorThrown, this.props);
            });
        }
    };

    setStopXlogHistory = () => {
        this.xlogHistoryRequestTime = null;
        this.setState({
            xlogHistoryDoing : false,
            xlogHistoryRequestCnt : 0
        });

    };

    getXLogHistory = (from, to, objects, longTerm) => {

        if (longTerm) {
            let data = this.state.data;
            let now = (new ServerDate()).getTime();
            data.lastRequestTime = now;
            data.tempXlogs = [];
            data.newXLogs = [];
            data.xlogs = [];
            data.startTime = from;
            data.endTime = to;

            this.setState({
                data: data,
                pastTimestamp: now
            });
            return;
        }

        //xlog retrieve limit is 60 minute
        if(to - from > 60 * 60 * 1000) {
            let data = this.state.data;
            let now = (new ServerDate()).getTime();
            data.lastRequestTime = now;
            data.tempXlogs = [];
            data.newXLogs = [];
            data.xlogs = [];
            data.startTime = from;
            data.endTime = to;

            this.setState({
                data: data,
                pastTimestamp: now,
                xlogNotSupportedInRange: true
            });
            return;
        }

        if (objects && objects.length > 0) {

            let data = this.state.data;
            let now = (new ServerDate()).getTime();
            data.lastRequestTime = now;
            data.tempXlogs = [];
            data.newXLogs = [];
            data.xlogs = [];
            data.startTime = from;
            data.endTime = to;

            this.setState({
                data: data,
                pastTimestamp: now,
                xlogHistoryDoing : true,
                xlogHistoryRequestCnt : 0,
                xlogNotSupportedInRange: false
            });

            let days = getSearchDays(from, to);
            let fromTos = getDivideDays(from, to);

            this.xlogHistoryTemp = [];
            this.xlogHistorytotalDays = days;
            this.xlogHistoryCurrentDays = 0;
            this.xlogHistoryRequestTime = now;

            if (days > 1) {
                for (let i = 0; i < fromTos.length; i++) {
                    this.getXLogHistoryData(now, fromTos[i].from, fromTos[i].to, objects);
                }
            } else {
                this.getXLogHistoryData(now, from, to, objects);
            }
        }
    };

    getXLogHistoryData = (requestTime, from, to, objects, lastTxid, lastXLogTime) => {
        let that = this;

        if (!this.mounted) {
            return;
        }

        if (this.xlogHistoryRequestTime !== requestTime) {
            return;
        }

        if (objects && objects.length > 0) {

            let data = this.state.data;

            this.props.addRequest();
            jQuery.ajax({
                method: "GET",
                async: true,
                dataType: 'text',
                url: getHttpProtocol(this.props.config) + "/scouter/v1/xlog/" + moment(from).format("YYYYMMDD") + "?startTimeMillis=" + from + '&endTimeMillis=' + to + (lastTxid ? '&lastTxid=' + lastTxid : "") + (lastXLogTime ? '&lastXLogTime=' + lastXLogTime : "") + '&objHashes=' +
                JSON.stringify(objects.map((instance) => {
                    return Number(instance.objHash);
                })),
                xhrFields: getWithCredentials(that.props.config),
                beforeSend: function (xhr) {
                    setAuthHeader(xhr, that.props.config, getCurrentUser(that.props.config, that.props.user));
                }
            }).done((msg) => {
                if (!that.mounted) {
                    return;
                }
                if (!msg) {
                    return;
                }

                if (this.xlogHistoryRequestTime !== requestTime) {
                    let data = this.state.data;
                    data.xlogs = Array.prototype.concat.apply([], that.xlogHistoryTemp);
                    this.setState({
                        data: data
                    });
                    return;
                }

                let result = (JSON.parse(msg)).result;

                let hasMore = result.hasMore;

                let xlogs = null;
                if (Number(this.props.config.xlog.normal.sampling) !== 100 || Number(this.props.config.xlog.error.sampling) !== 100) {
                    xlogs = this.sampling(result.xlogs);
                } else {
                    xlogs = result.xlogs;
                }

                that.xlogHistoryTemp.push(xlogs);
                data.newXLogs = xlogs;

                this.setState({
                    data: data,
                    pageCnt: (new Date()).getTime(),
                    xlogHistoryRequestCnt : this.state.xlogHistoryRequestCnt + 1
                });

                if (hasMore) {
                    that.getXLogHistoryData(requestTime, from, to, objects, result.lastTxid, result.lastXLogTime);
                } else {
                    that.xlogHistoryCurrentDays++;
                    if (that.xlogHistoryTotalDays <= that.xlogHistoryCurrentDays) {
                        let data = this.state.data;
                        data.xlogs = Array.prototype.concat.apply([], that.xlogHistoryTemp);
                        this.setState({
                            data: data,
                            pageCnt: (new Date()).getTime(),
                            xlogHistoryDoing : false,
                            xlogHistoryRequestCnt : 0
                        });
                    }
                }

            }).fail((xhr, textStatus, errorThrown) => {
                errorHandler(xhr, textStatus, errorThrown, this.props);
            });
        }
    };

    getVisitor = () => {
        let that = this;
        if (this.props.objects && this.props.objects.length > 0) {
            this.props.addRequest();
            let time = (new ServerDate()).getTime();
            jQuery.ajax({
                method: "GET",
                async: true,
                url: getHttpProtocol(this.props.config) + '/scouter/v1/visitor/realTime?objHashes=' + JSON.stringify(this.props.objects.map((instance) => {
                    return Number(instance.objHash);
                })),
                xhrFields: getWithCredentials(that.props.config),
                beforeSend: function (xhr) {
                    setAuthHeader(xhr, that.props.config, getCurrentUser(that.props.config, that.props.user));
                }
            }).done((msg) => {
                if (!that.mounted) {
                    return;
                }
                this.setState({
                    visitor: {
                        time: time,
                        visitor: msg.result
                    }
                });
            }).fail((xhr, textStatus, errorThrown) => {
                errorHandler(xhr, textStatus, errorThrown, this.props);
            });
        }
    };


    getCounterHistoryData = (url, counterKey, from, to, now, append) => {
        this.setLoading(true);
        let that = this;
        this.props.addRequest();
        jQuery.ajax({
            method: "GET",
            async: true,
            url: url,
            xhrFields: getWithCredentials(that.props.config),
            beforeSend: function (xhr) {
                setAuthHeader(xhr, that.props.config, getCurrentUser(that.props.config, that.props.user));
            }
        }).done((msg) => {
            if (!this.mounted) {
                return;
            }
            let countersHistory = this.state.countersHistory.data ? Object.assign({}, this.state.countersHistory.data) : {};

            let counterHistory;
            if (msg.result) {
                for (let i = 0; i < msg.result.length; i++) {
                    let counter = msg.result[i];
                    counterHistory = countersHistory[counterKey] ? countersHistory[counterKey] : {};
                    if (counter.valueList.length > 0) {
                        if (append) {
                            if (counterHistory[counter.objHash]) {
                                counterHistory[counter.objHash].timeList = counterHistory[counter.objHash].timeList.concat(counter.timeList);
                                counterHistory[counter.objHash].valueList = counterHistory[counter.objHash].valueList.concat(counter.valueList);
                                counterHistory[counter.objHash].unit = counter.unit;
                                countersHistory[counterKey] = counterHistory;
                            } else {
                                counterHistory[counter.objHash] = {};
                                counterHistory[counter.objHash].timeList = counter.timeList;
                                counterHistory[counter.objHash].valueList = counter.valueList;
                                counterHistory[counter.objHash].unit = counter.unit;
                                countersHistory[counterKey] = counterHistory;
                            }
                        } else {
                            counterHistory[counter.objHash] = {};
                            counterHistory[counter.objHash].timeList = counter.timeList;
                            counterHistory[counter.objHash].valueList = counter.valueList;
                            counterHistory[counter.objHash].unit = counter.unit;
                            countersHistory[counterKey] = counterHistory;
                        }
                    }
                }
            }

            for (let key in countersHistory) {
                for (let objHash in countersHistory[key]) {
                    let smallInx = -1;
                    let temp = [];
                    for (let i = 0; i < countersHistory[key][objHash].timeList.length; i++) {
                        temp.push({
                            time: Number(countersHistory[key][objHash].timeList[i]),
                            value: countersHistory[key][objHash].valueList[i]
                        });
                    }
                    temp.sort((a, b) => a.time - b.time);
                    for (let i = 0; i < temp.length; i++) {
                        if (from < temp[i].time) {
                            smallInx = i;
                            break;
                        }
                    }

                    if (smallInx > -1) {
                        temp.splice(0, smallInx);
                    }

                    let binInx = -1;
                    for (let i = temp.length - 1; i > -0; i--) {
                        if (to > temp[i].time) {
                            binInx = i;
                            break;
                        }
                    }

                    if (binInx > -1) {
                        temp.splice(binInx + 1, temp.length - binInx);
                    }

                    countersHistory[key][objHash].timeList = temp.map((d) => d.time);
                    countersHistory[key][objHash].valueList = temp.map((d) => d.value);
                }
            }

            this.setState({
                countersHistory: {
                    time: new Date().getTime(),
                    data: countersHistory,
                    from: from,
                    to: to
                }
            });

            this.counterHistoriesLoaded[counterKey] = true;

            this.setLoading(false);
        }).fail((xhr, textStatus, errorThrown) => {
            errorHandler(xhr, textStatus, errorThrown, this.props);
        });
    }

    removeOverTimeXLogFrom(tempXlogs, startTime) {
        let outOfRangeIndex = -1;
        for (let i = 0; i < tempXlogs.length; i++) {
            let d = tempXlogs[i];
            if (startTime < d.endTime) {
                break;
            }
            outOfRangeIndex = i;
        }

        if (outOfRangeIndex > -1) {
            tempXlogs.splice(0, outOfRangeIndex + 1);
        }
    }

    onLayoutChange(layout, layouts) {

        let boxes = this.state.boxes;
        boxes.forEach((box) => {
            layout.forEach((l) => {
                if (box.key === l.i) {
                    box.layout = l;
                    return false;
                }
            });
        });
        setData("layouts", layouts);
        setData("boxes", this.state.boxes);
        this.setState({
            layouts: layouts,
            layoutChangeTime: (new Date()).getTime()
        });

        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 500);

    }

    getUniqueKey() {
        let dup = false;
        let key = null;
        let i = 1;
        do {
            dup = false;
            key = String(this.state.boxes.length + i);
            for (let i = 0; i < this.state.boxes.length; i++) {
                if (this.state.boxes[i].key === key) {
                    dup = true;
                    break;
                }
            }
            i++;
        } while (dup);

        return key;
    }

    toggleRangeControl = () => {
        this.setState({
            rangeControl: !this.state.rangeControl
        });
    };

    addPaper = () => {
        let boxes = this.state.boxes;
        let key = this.getUniqueKey();

        let maxY = 0;
        let height = 0;
        for (let i = 0; i < boxes.length; i++) {
            if (maxY < boxes[i].layout.y) {
                maxY = boxes[i].layout.y;
                height = boxes[i].layout.h;
            }
        }

        boxes.push({
            key: key,
            title: "NO TITLE ",
            layout: {w: 6, h: 4, x: 0, y: (maxY + height), minW: 1, minH: 3, i: key}
        });


        this.setState({
            boxes: boxes
        });

        setData("boxes", boxes);

        return key;
    };

    addPaperAndAddMetric = (data) => {
        let key = this.addPaper();

        if (data) {
            let option = JSON.parse(data);
            this.setOption(key, option);
        }
    };

    removePaper = (key) => {

        let boxes = this.state.boxes;
        boxes.forEach((box, i) => {
            if (box.key === key) {
                boxes.splice(i, 1);
                return false;
            }
        });

        let layouts = this.state.layouts;

        for (let unit in layouts) {
            if (layouts[unit] && layouts[unit].length > 0) {
                layouts[unit].forEach((layout, i) => {
                    if (layout.i === key) {
                        layouts[unit].splice(i, 1);
                        return false;
                    }
                })
            }
        }

        this.setState({
            boxes: boxes,
            layouts: layouts,
            layoutChangeTime: (new Date()).getTime()
        });

        setData("layouts", layouts);
        setData("boxes", boxes);
    };

    clearLayout = () => {
        this.setState({
            boxes: [],
            layouts: {},
            layoutChangeTime: (new Date()).getTime()
        });
    };

    setOption = (key, option) => {

        let boxes = this.state.boxes.slice(0);

        boxes.forEach((box) => {
            if (box.key === key) {

                if (option.mode === "exclusive") {
                    box.option = {
                        mode: option.mode,
                        type: option.type,
                        config: option.config,
                        counterKey: option.counterKey,
                        title: option.title
                    };
                } else {

                    if (!box.option) {
                        box.option = [];
                    }

                    if (box.option && !Array.isArray(box.option)) {
                        box.option = [];
                    }

                    let duplicated = false;
                    for (let i = 0; i < box.option.length; i++) {
                        if (box.option[i].counterKey === option.name && box.option[i].familyName === option.familyName) {
                            duplicated = true;
                            break;
                        }
                    }

                    if (!duplicated) {
                        box.option.push({
                            mode: "nonexclusive",
                            type: "counter",
                            config: option.config,
                            counterKey: option.name,
                            title: option.displayName,
                            familyName : option.familyName
                        });
                    }
                }

                box.values = {};
                for (let attr in option.config) {
                    box.values[attr] = option.config[attr].value;
                }

                if (Array.isArray(box.option)) {
                    box.config = false;
                    let title = "";
                    for (let i = 0; i < box.option.length; i++) {
                        title += box.option[i].title;
                        if (i < (box.option.length - 1)) {
                            title += ", ";
                        }
                    }
                    box.title = title
                } else {
                    box.config = false;
                    box.title = option.title;
                }

                return false;
            }
        });

        this.setState({
            boxes: boxes
        });

        setData("boxes", boxes);
    };

    setOptionValues = (key, values) => {
        let boxes = this.state.boxes;
        boxes.forEach((box) => {
            if (box.key === key) {
                for (let attr in values) {
                    box.values[attr] = values[attr];
                }

                box.config = false;
            }
        });

        this.setState({
            boxes: boxes
        });

        setData("boxes", boxes);
    };

    removeMetrics = (boxKey, counterKeys) => {

        if (this.boxesRef && this.boxesRef[boxKey]) {
            this.boxesRef[boxKey].removeTitle(counterKeys);
        }

        let boxes = this.state.boxes.slice(0);
        boxes.forEach((box) => {
            if (box.key === boxKey) {
                box.config = false;

                let options = box.option.filter((option) => {
                    let index = counterKeys.findIndex(function (e) {
                        return e === option.counterKey;
                    });

                    return index < 0;
                });

                box.option = options;
                box.config = false;
                let title = "";
                if (box.option.length > 0) {
                    for (let i = 0; i < box.option.length; i++) {
                        title += box.option[i].title;
                        if (i < (box.option.length - 1)) {
                            title += ", ";
                        }
                    }
                    box.title = title
                } else {
                    box.title = "NO TITLE";
                }
            }
        });

        this.setState({
            boxes: boxes
        });

        setData("boxes", boxes);
    };

    setOptionClose = (key) => {
        let boxes = this.state.boxes;
        boxes.forEach((box) => {
            if (box.key === key) {
                box.config = false;
            }
        });

        this.setState({
            boxes: boxes
        });

        setData("boxes", boxes);
    };


    toggleConfig = (key) => {
        let boxes = this.state.boxes;
        boxes.forEach((box) => {
            if (box.key === key) {
                box.config = !box.config;
                return false;
            }
        });

        this.setState({
            boxes: boxes
        });

    };

    toggleFilter = (key) => {
        let filters = this.state.filters;
        let found = false;
        filters.forEach((filter) => {
            if (filter.key === key) {
                filter.show = !filter.show;
                found = true;
                return false;
            }
        });

        if (!found) {
            filters.push({
                key : key,
                show : true,
                data : {
                    filtering : false
                }
            });
        }
        
        this.setState({
            filters: filters
        });
    };

    setXlogFilter = (key, filtering, filter) => {
        let filters = Object.assign(this.state.filters);
        let filterInfo = filters.filter((d) => d.key === key)[0];
        filterInfo.show = false;
        if (filtering) {
            filter.filtering = true;
            filterInfo.data = filter;
        } else {
            filterInfo.data = {filtering : false};
        }

        this.setState({
            filters: filters
        });
    };

    closeFilter = (key) => {
        let filters = Object.assign(this.state.filters);
        let filterInfo = filters.filter((d) => d.key === key)[0];
        filterInfo.show = false;
        this.setState({
            filters: filters
        });
    };



    render() {
        let objectSelected = this.props.objects.length > 0;

        if (objectSelected) {
            document.querySelector("body").style.overflow = "auto";
        } else {
            //document.querySelector("body").style.overflow = "hidden";
        }

        return (
            <div className="papers">
                {!this.props.supported.supported && <OldVersion />}
                {this.props.supported.supported &&
                <div>
                <div className={"fixed-alter-object " + (this.state.fixedControl ? 'show' : '')}></div>
                <PaperControl addPaper={this.addPaper} addPaperAndAddMetric={this.addPaperAndAddMetric} clearLayout={this.clearLayout} fixedControl={this.state.fixedControl} toggleRangeControl={this.toggleRangeControl} realtime={this.props.range.realTime} alert={this.state.alert} clearAllAlert={this.clearAllAlert} clearOneAlert={this.clearOneAlert} setRewind={this.setRewind} showAlert={this.state.showAlert} toggleShowAlert={this.toggleShowAlert} />
                <RangeControl visible={this.state.rangeControl} search={this.search} fixedControl={this.state.fixedControl} toggleRangeControl={this.toggleRangeControl} changeLongTerm={this.changeLongTerm}/>
                {(objectSelected && (!this.state.boxes || this.state.boxes.length === 0)) &&
                <div className="quick-usage">
                    <div>
                        <div>
                            <div>
                                <h3>NO PAPER</h3>
                                <ol>
                                    <li>CLICK [<i className="fa fa-plus-circle" aria-hidden="true"></i>] BUTTON TO ADD PAPER</li>
                                    <li>AND DRAG METRIC TO PAPER</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </div>}
                <ResponsiveReactGridLayout className="layout" cols={{lg: 12, md: 10, sm: 6, xs: 4, xxs: 2}} layouts={this.state.layouts} rowHeight={30} onLayoutChange={(layout, layouts) => this.onLayoutChange(layout, layouts)}>
                    {this.state.boxes.map((box, i) => {
                        let filterInfo = this.state.filters.filter((d) => d.key === box.key)[0];
                        return (
                            <div className="box-layout" key={box.key} data-grid={box.layout}>
                                <button className="box-control box-layout-remove-btn last" onClick={this.removePaper.bind(null, box.key)}><i className="fa fa-times-circle-o" aria-hidden="true"></i></button>
                                {box.option && <button className="box-control box-layout-config-btn" onClick={this.toggleConfig.bind(null, box.key)}><i className="fa fa-cog" aria-hidden="true"></i></button>}
                                {box.option && (box.option.length > 1 || box.option.config ) && box.option.type === "xlog" && <button className={"box-control filter-btn " + (filterInfo && filterInfo.data && filterInfo.data.filtering ? "filtered" : "")} onClick={this.toggleFilter.bind(null, box.key)}><i className="fa fa-filter" aria-hidden="true"></i></button>}                                
                                {box.config && <BoxConfig box={box} setOptionValues={this.setOptionValues} setOptionClose={this.setOptionClose} removeMetrics={this.removeMetrics}/>}
                                {filterInfo && filterInfo.show && <XLogFilter box={box} filterInfo={filterInfo ? filterInfo.data : {filtering : false}} setXlogFilter={this.setXlogFilter} closeFilter={this.closeFilter} />}
                                <Box onRef={ref => this.boxesRef[box.key] = ref} visible={this.state.visible} setOption={this.setOption} box={box} filter={filterInfo ? filterInfo.data : {filtering : false}} pastTimestamp={this.state.pastTimestamp} pageCnt={this.state.pageCnt} data={this.state.data} config={this.props.config} visitor={this.state.visitor} counters={this.state.counters} countersHistory={this.state.countersHistory.data} countersHistoryFrom={this.state.countersHistory.from} countersHistoryTo={this.state.countersHistory.to} countersHistoryTimestamp={this.state.countersHistory.time} longTerm={this.props.range.longTerm} layoutChangeTime={this.state.layoutChangeTime} realtime={this.props.range.realTime} xlogHistoryDoing={this.state.xlogHistoryDoing} xlogHistoryRequestCnt={this.state.xlogHistoryRequestCnt} setStopXlogHistory={this.setStopXlogHistory} xlogNotSupportedInRange={this.state.xlogNotSupportedInRange}/>
                            </div>
                        )
                    })}
                </ResponsiveReactGridLayout>
                {!objectSelected &&
                <div className={"select-instance " + (this.state.fixedControl ? 'fixed' : '')}>
                    <div>
                        <div className="select-instance-message">
                            <div className="icon">
                                <div><i className="fa fa-info-circle" aria-hidden="true"></i></div>
                            </div>
                            <div className="msg">NO INSTANCE SELECTED</div>
                        </div>
                    </div>
                </div>
                }
                <Profiler selection={this.props.selection} newXLogs={this.state.data.newXLogs} xlogs={this.state.data.xlogs} startTime={this.state.data.startTime} realtime={this.props.range.realTime}/>
                <div className="loading" ref="loading">
                    <div>
                        <div className="spinner">
                            <div className="cube1"></div>
                            <div className="cube2"></div>
                        </div>
                    </div>
                </div>
                </div>}
            </div>
        );
    }
}

let mapStateToProps = (state) => {
        return {
            objects: state.target.objects,
            selection: state.target.selection,
            config: state.config,
            user: state.user,
            template: state.template,
            range: state.range,
            supported : state.supported
        };
    };

let mapDispatchToProps = (dispatch) => {
        return {
            addRequest: () => dispatch(addRequest()),
            pushMessage: (category, title, content) => dispatch(pushMessage(category, title, content)),
            setControlVisibility: (name, value) => dispatch(setControlVisibility(name, value)),

            setRealTime : (realTime, longTerm) => dispatch(setRealTime(realTime, longTerm)),
            setRealTimeValue: (realTime, longTerm, value) => dispatch(setRealTimeValue(realTime, longTerm, value)),
            setRangeDate: (date) => dispatch(setRangeDate(date)),
            setRangeHours: (hours) => dispatch(setRangeHours(hours)),
            setRangeMinutes: (minutes) => dispatch(setRangeMinutes(minutes)),
            setRangeValue: (value) => dispatch(setRangeValue(value)),
            setRangeDateHoursMinutes: (date, hours, minutes) => dispatch(setRangeDateHoursMinutes(date, hours, minutes)),
            setRangeDateHoursMinutesValue: (date, hours, minutes, value) => dispatch(setRangeDateHoursMinutesValue(date, hours, minutes, value)),
            setRangeAll: (date, hours, minutes, value, realTime, longTerm, range, step) => dispatch(setRangeAll(date, hours, minutes, value, realTime, longTerm, range, step)),

            setTemplate: (boxes, layouts) => dispatch(setTemplate(boxes, layouts))

        };
    };

Paper = connect(mapStateToProps, mapDispatchToProps)(Paper);
export default withRouter(Paper);
