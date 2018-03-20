import React, {Component} from 'react';
import './SocketSumStep.css';
import StepGeneral from "../StepGeneral/StepGeneral";

class SocketSumStep extends Component {
    render() {
        return (
            <div className="step hashed-message">
                {this.props.row.step.time > -1 &&
                <StepGeneral startTime={this.props.startTime} row={this.props.row} elapsed={this.props.row.step.time} type="MSG"/>
                }
                <div className="message-content">{this.props.row.mainValue}</div>
            </div>)
    }
}

export default SocketSumStep;